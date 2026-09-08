import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  assertNoExternalContentImages,
  buildFileName,
  extractImageSources,
  localizeContentImages,
  saveImageLocally,
} from './download-image.ts';

describe('buildFileName — 同一性は呼び出し側が明示する', () => {
  const base = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/84cd3f39/b7e03953/hero.png';
  const signedA = new URL(`${base}?X-Amz-Date=20260902T180010Z&X-Amz-Signature=aaa&X-Amz-Expires=3600`);
  const signedB = new URL(`${base}?X-Amz-Date=20260903T090000Z&X-Amz-Signature=bbb&X-Amz-Expires=3600`);

  it("origin-path: 署名クエリが変わっても同じファイルに収束する", () => {
    // Notion の HeroImage は取得のたびに X-Amz-Signature が変わる。
    // クエリを含めると毎ビルド別名になり、public/notion-static が際限なく増える
    assert.equal(buildFileName(signedA, '.png', 'origin-path'), buildFileName(signedB, '.png', 'origin-path'));
  });

  it("full-url: クエリが違えば別のファイルになる", () => {
    // 外部の chart / badge / image proxy は ?id=1 と ?id=2 で別の画像を返す。
    // ここを潰すと 2 枚目に 1 枚目の中身が出る
    const a = new URL('https://charts.example.com/render?id=1');
    const b = new URL('https://charts.example.com/render?id=2');
    assert.notEqual(buildFileName(a, '.png', 'full-url'), buildFileName(b, '.png', 'full-url'));
  });

  it("full-url と origin-path は同じ URL でも別のファイルになる", () => {
    // 同一性の policy を取り違えたときに、黙って同じ成果物を見ない
    assert.notEqual(buildFileName(signedA, '.png', 'full-url'), buildFileName(signedA, '.png', 'origin-path'));
  });

  it('パス・ホストが違えば別のファイル名になる', () => {
    for (const identity of ['origin-path', 'full-url'] as const) {
      assert.notEqual(
        buildFileName(new URL('https://example.com/a/hero.png'), '.png', identity),
        buildFileName(new URL('https://example.com/b/hero.png'), '.png', identity),
      );
      assert.notEqual(
        buildFileName(new URL('https://example.com/hero.png'), '.png', identity),
        buildFileName(new URL('https://other.example/hero.png'), '.png', identity),
      );
    }
  });

  it('拡張子が付き、ファイル名として安全な文字だけになる', () => {
    // 日本語ファイル名の画像（旧ドメインの本文画像）でも壊れないこと
    const url = new URL('https://example.com/uploads/ホソヘリ2齢-1024x768.jpg');
    assert.match(buildFileName(url, '.jpg', 'full-url'), /^[0-9a-f]{16}\.jpg$/);
  });
});

describe('saveImageLocally — ローカル画像は素通しする', () => {
  // 本文に図を入れる暫定手段。public/images/ に置いて /images/... で参照する。
  // ネットワークにもディスクにも触らずそのまま返ること（＝ビルドを止めないこと）を固定する。
  it('サイト内の絶対パスはそのまま返す', async () => {
    assert.equal(await saveImageLocally('/images/ammi-biplot.png', 'ctx'), '/images/ammi-biplot.png');
    assert.equal(await saveImageLocally('/images/図1.png', 'ctx'), '/images/図1.png');
  });

  it('相対パスもそのまま返す', async () => {
    assert.equal(await saveImageLocally('./fig.png', 'ctx'), './fig.png');
  });

  it('data: URI はそのまま返す', async () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(await saveImageLocally(uri, 'ctx'), uri);
  });
});

describe('localizeContentImages — ローカル画像を含む本文', () => {
  it('/images/ の参照は書き換えない', async () => {
    const content = '<figure><img src="/images/ammi-biplot.png" alt="AMMI"/></figure>';
    assert.equal(await localizeContentImages(content, 'ctx'), content);
  });

  it('img が無い本文はそのまま返す', async () => {
    const content = '<p>図のない記事</p>';
    assert.equal(await localizeContentImages(content, 'ctx'), content);
  });
});

describe('assertNoExternalContentImages — ローカル化後に外部 URL が残っていないこと', () => {
  // これはポリシー検査（「外部 URL を書くな」）ではなく事後条件。
  // localizeContentImages を通した結果に対して呼ぶ。あちらは外部 URL を
  // ダウンロードして置き換えるか例外を投げるかのどちらかなので、ここに
  // 引っかかるのは実装が壊れたときだけ。
  const localized = '<figure><img src="/notion-static/ab12cd34.png" alt="AMMI"/></figure>';
  const handPlaced = '<figure><img src="/images/ammi-biplot.png" alt="AMMI"/></figure>';

  it('ローカル化済み・手置きのサイト内パスは通す', () => {
    assert.doesNotThrow(() => assertNoExternalContentImages([{ slug: 'a', content: localized }]));
    assert.doesNotThrow(() => assertNoExternalContentImages([{ slug: 'a', content: handPlaced }]));
    assert.doesNotThrow(() => assertNoExternalContentImages([{ slug: 'a', content: '<p>図なし</p>' }]));
    assert.doesNotThrow(() =>
      assertNoExternalContentImages([{ slug: 'a', content: '<img src="data:image/png;base64,iVBORw0KGgo="/>' }]),
    );
  });

  it('外部 URL が残っていたら止める', () => {
    assert.throws(
      () => assertNoExternalContentImages([{ slug: 'a', content: '<img src="https://example.com/x.png"/>' }]),
      /外部の画像 URL/,
    );
  });

  it('全記事をまとめて挙げ、実装を疑うよう促す', () => {
    try {
      assertNoExternalContentImages([
        { slug: 'ok-post', content: localized },
        { slug: 'post-a', content: '<img src="https://example.com/a.png"/>' },
        { slug: 'post-b', content: '<img src="https://example.com/b.png"/>' },
      ]);
      assert.fail('例外が投げられなかった');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /2 記事・計 2 箇所/);
      assert.match(message, /post-a/);
      assert.match(message, /post-b/);
      assert.doesNotMatch(message, /ok-post/);
      // ポリシー違反ではなく事後条件の違反として説明されること
      assert.match(message, /ローカル化を通したのに/);
      assert.match(message, /download-image\.ts/);
    }
  });

  it('対象は渡された記事だけ（下書きは呼び出し側で除外される）', () => {
    assert.doesNotThrow(() => assertNoExternalContentImages([]));
  });
});

describe('extractImageSources', () => {
  it('src を重複なく取り出す', () => {
    assert.deepEqual(
      extractImageSources('<img src="/a.png"/><img src="/b.png"/><img src="/a.png"/>'),
      ['/a.png', '/b.png'],
    );
  });

  it('img が無ければ空', () => {
    assert.deepEqual(extractImageSources('<p>本文</p>'), []);
  });
});

/* ------------------------------------------------- 実キャッシュを汚さない土台 */

/**
 * テスト用の保存先。
 *
 * 以前はこの describe が本物の `public/notion-static/` へ書き込んでいた。
 * 1 回の `npm test` で 3 ファイル増え、削除もされず、copy-downloaded-images が
 * それを `dist` まで運んでいた（実測）。保存先を注入して隔離する。
 */
let cacheRoot: string;
let outputDir: string;
let metadataDir: string;

before(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), 'notion-static-test-'));
  // 本番と同じく、画像と検証記録は別のディレクトリに置く
  // （記録を public/ の中へ置くと Astro のコピーで公開されてしまう）
  outputDir = path.join(cacheRoot, 'images');
  metadataDir = path.join(cacheRoot, 'metadata');
});

after(async () => {
  await rm(cacheRoot, { recursive: true, force: true });
});

/** 実ネットワークへ出さずに 1 回だけ応答を返す。呼ばれた回数を数える */
function stubFetch(respond: () => Response) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return respond();
  }) as typeof fetch;
  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

const imageResponse = (contentType: string, body = 'x') =>
  new Response(body, { status: 200, headers: { 'content-type': contentType } });

/** テストごとに衝突しない URL。同じ pathname を共有したいときは suffix を渡す */
const uniqueUrl = (suffix = '') =>
  `https://example.invalid/probe/${Math.random().toString(36).slice(2)}${suffix}`;

describe('saveImageLocally — content-type を必ず検証する', () => {
  async function withFetch(
    response: Response,
    run: (url: string) => Promise<string>,
  ): Promise<{ result?: string; error?: Error }> {
    const fetchStub = stubFetch(() => response);
    const url = uniqueUrl();
    try {
      return { result: await run(url) };
    } catch (error) {
      return { error: error as Error };
    } finally {
      fetchStub.restore();
    }
  }

  const save = (url: string) => saveImageLocally(url, 'probe', { outputDir, metadataDir });

  it('画像でない content-type は落とす（URL の拡張子が既知でも）', async () => {
    // 以前は URL が .svg で終われば content-type を見ずに通り、
    // text/html の中身が .svg として公開されていた
    for (const contentType of ['text/html', 'application/json', 'text/plain']) {
      const { error } = await withFetch(imageResponse(contentType), (url) => save(`${url}.svg`));
      assert.ok(error, `${contentType} を通した`);
      assert.match(error!.message, /画像ではない応答/);
    }
  });

  it('.png でも content-type が text/html なら落とす', async () => {
    const { error } = await withFetch(imageResponse('text/html'), (url) => save(`${url}.png`));
    assert.match(error!.message, /画像ではない応答/);
  });

  it('content-type が空でも落とす', async () => {
    const { error } = await withFetch(new Response('x', { status: 200 }), (url) => save(`${url}.svg`));
    assert.ok(error);
  });

  it('拡張子と content-type が一致すれば通る', async () => {
    const { result, error } = await withFetch(imageResponse('image/svg+xml', '<svg/>'), (url) =>
      save(`${url}.svg`),
    );
    assert.equal(error, undefined, error?.message);
    assert.match(result!, /^\/notion-static\/[0-9a-f]{16}\.svg$/);
  });

  it('サブタイプの無い content-type: image は URL の拡張子で補う', async () => {
    // Notion の実データに存在する（2026-09-06 実測）。ここを厳しくすると
    // 正常な画像でビルドが止まる
    const { result, error } = await withFetch(imageResponse('image'), (url) => save(`${url}.png`));
    assert.equal(error, undefined, error?.message);
    assert.match(result!, /\.png$/);
  });

  it('拡張子が無くても正しい画像 content-type なら通る', async () => {
    const { result, error } = await withFetch(imageResponse('image/webp'), (url) => save(url));
    assert.equal(error, undefined, error?.message);
    assert.match(result!, /\.webp$/);
  });

  it('拡張子が無く content-type も判別できなければ落とす', async () => {
    const { error } = await withFetch(imageResponse('image'), (url) => save(url));
    assert.match(error!.message, /拡張子を判別できませんでした/);
  });

  it('拡張子と content-type が食い違えば落とす（配信は拡張子で決まるため）', async () => {
    const { error } = await withFetch(imageResponse('image/png'), (url) => save(`${url}.svg`));
    assert.match(error!.message, /食い違って/);
  });

  it('エラー文に署名クエリを出さない', async () => {
    const fetchStub = stubFetch(() => imageResponse('text/html'));
    try {
      await save(`${uniqueUrl('.svg')}?X-Amz-Signature=SECRET123`);
      assert.fail('落ちるはず');
    } catch (error) {
      assert.doesNotMatch((error as Error).message, /SECRET123/);
    } finally {
      fetchStub.restore();
    }
  });
});

/* ------------------------------------------------------- 検証済みキャッシュ */

describe('saveImageLocally — 検証済みの成果物だけを再利用する', () => {
  const save = (url: string, identity: 'origin-path' | 'full-url' = 'full-url') =>
    saveImageLocally(url, 'probe', { outputDir, metadataDir, identity });

  /** 保存された成果物のパスから、隣の検証記録のファイル名を作る */
  const metadataNameOf = (localSrc: string) => `${path.basename(localSrc).split('.')[0]}.json`;

  it('1. 正常取得したら成果物と検証記録が publish される', async () => {
    const fetchStub = stubFetch(() => imageResponse('image/svg+xml', '<svg>ok</svg>'));
    try {
      const src = await save(`${uniqueUrl('.svg')}`);
      assert.match(src, /^\/notion-static\/[0-9a-f]{16}\.svg$/);

      const metadata = JSON.parse(
        await readFile(path.join(metadataDir, metadataNameOf(src)), 'utf-8'),
      );
      assert.equal(metadata.version, 1);
      assert.equal(metadata.contentType, 'image/svg+xml');
      assert.equal(metadata.extension, '.svg');
      assert.equal(metadata.bytes, Buffer.byteLength('<svg>ok</svg>'));
      assert.equal(metadata.identity, 'full-url');
    } finally {
      fetchStub.restore();
    }
  });

  it('検証記録に署名やクエリを残さない', async () => {
    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      const src = await save(`${uniqueUrl('.png')}?X-Amz-Signature=SECRET123&token=SECRET456`);
      const raw = await readFile(path.join(metadataDir, metadataNameOf(src)), 'utf-8');
      assert.doesNotMatch(raw, /SECRET123/);
      assert.doesNotMatch(raw, /SECRET456/);
      assert.doesNotMatch(raw, /X-Amz-Signature/);
    } finally {
      fetchStub.restore();
    }
  });

  it('2. cache hit では remote を引かない', async () => {
    const url = `${uniqueUrl('.svg')}`;
    const first = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    let src: string;
    try {
      src = await save(url);
      assert.equal(first.calls, 1);
    } finally {
      first.restore();
    }

    const second = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    try {
      assert.equal(await save(url), src);
      assert.equal(second.calls, 0, 'cache hit なのに fetch した');
    } finally {
      second.restore();
    }
  });

  it('3. 検証記録の無い旧キャッシュは信用せず取り直す', async () => {
    // 旧実装（記録を書かない版）が残した成果物を再現する
    const url = `${uniqueUrl('.svg')}`;
    const digest = path.basename(buildFileName(new URL(url), '.svg', 'full-url'), '.svg');
    await writeFile(path.join(outputDir, `${digest}.svg`), '<svg>stale</svg>');

    const fetchStub = stubFetch(() => imageResponse('image/svg+xml', '<svg>fresh</svg>'));
    try {
      const src = await save(url);
      assert.equal(fetchStub.calls, 1, '記録が無いのに再取得しなかった');
      assert.equal(await readFile(path.join(outputDir, path.basename(src)), 'utf-8'), '<svg>fresh</svg>');
    } finally {
      fetchStub.restore();
    }
  });

  it('4. 旧実装が残した不正な成果物（.svg の中身が HTML）を素通りさせない', async () => {
    // 修正前は「.svg のファイルが存在する」だけで fetch ごと飛ばしていたため、
    // text/html を .svg として保存した成果物がそのまま公開され続けていた（実測）
    const url = `${uniqueUrl('.svg')}`;
    const digest = path.basename(buildFileName(new URL(url), '.svg', 'full-url'), '.svg');
    await writeFile(path.join(outputDir, `${digest}.svg`), '<script>alert(1)</script>');

    const fetchStub = stubFetch(() => imageResponse('text/html', '<html>evil</html>'));
    try {
      await assert.rejects(save(url), /画像ではない応答/);
      assert.equal(fetchStub.calls, 1, '汚染された成果物を検証せずに返した');
    } finally {
      fetchStub.restore();
    }
  });

  it('5. content-type が今の規則に合わない記録は再利用しない', async () => {
    // 手で書いた「検証済みを名乗る」記録。規則を通らないので cache miss になり、
    // 取り直したうえで改めて判定される
    const url = `${uniqueUrl('.svg')}`;
    const digest = path.basename(buildFileName(new URL(url), '.svg', 'full-url'), '.svg');
    const body = '<svg>poisoned</svg>';
    await writeFile(path.join(outputDir, `${digest}.svg`), body);
    await writeFile(
      path.join(metadataDir, `${digest}.json`),
      JSON.stringify({
        version: 1,
        contentType: 'text/html',
        extension: '.svg',
        bytes: Buffer.byteLength(body),
        identity: 'full-url',
        validatedAt: new Date().toISOString(),
      }),
    );

    const fetchStub = stubFetch(() => imageResponse('text/html'));
    try {
      await assert.rejects(save(url), /画像ではない応答/);
      assert.equal(fetchStub.calls, 1);
    } finally {
      fetchStub.restore();
    }
  });

  it('5b. MIME と拡張子が食い違う記録は再利用しない', async () => {
    const url = `${uniqueUrl('.svg')}`;
    const digest = path.basename(buildFileName(new URL(url), '.svg', 'full-url'), '.svg');
    const body = 'not really an svg';
    await writeFile(path.join(outputDir, `${digest}.svg`), body);
    await writeFile(
      path.join(metadataDir, `${digest}.json`),
      JSON.stringify({
        version: 1,
        // 記録上は PNG なのに .svg として保存されている
        contentType: 'image/png',
        extension: '.svg',
        bytes: Buffer.byteLength(body),
        identity: 'full-url',
        validatedAt: new Date().toISOString(),
      }),
    );

    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      await assert.rejects(save(url), /食い違って/);
      assert.equal(fetchStub.calls, 1);
    } finally {
      fetchStub.restore();
    }
  });

  it('記録とファイルの不整合（バイト数違い）で fail open しない', async () => {
    const url = `${uniqueUrl('.svg')}`;
    const first = stubFetch(() => imageResponse('image/svg+xml', '<svg>a</svg>'));
    let src: string;
    try {
      src = await save(url);
    } finally {
      first.restore();
    }

    // 成果物だけを差し替える（記録は残したまま）
    await writeFile(path.join(outputDir, path.basename(src)), '<svg>tampered-and-longer</svg>');

    const second = stubFetch(() => imageResponse('image/svg+xml', '<svg>a</svg>'));
    try {
      await save(url);
      assert.equal(second.calls, 1, 'バイト数が食い違う成果物を再利用した');
      assert.equal(await readFile(path.join(outputDir, path.basename(src)), 'utf-8'), '<svg>a</svg>');
    } finally {
      second.restore();
    }
  });

  it('記録が壊れた JSON でも fail open しない', async () => {
    const url = `${uniqueUrl('.svg')}`;
    const first = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    let src: string;
    try {
      src = await save(url);
    } finally {
      first.restore();
    }
    await writeFile(path.join(metadataDir, metadataNameOf(src)), '{ this is not json');

    const second = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    try {
      await save(url);
      assert.equal(second.calls, 1, '壊れた記録を信用した');
    } finally {
      second.restore();
    }
  });

  it('形式版が違う記録は再利用しない', async () => {
    const url = `${uniqueUrl('.svg')}`;
    const first = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    let src: string;
    try {
      src = await save(url);
    } finally {
      first.restore();
    }
    const metadata = JSON.parse(await readFile(path.join(metadataDir, metadataNameOf(src)), 'utf-8'));
    await writeFile(
      path.join(metadataDir, metadataNameOf(src)),
      JSON.stringify({ ...metadata, version: 999 }),
    );

    const second = stubFetch(() => imageResponse('image/svg+xml', '<svg/>'));
    try {
      await save(url);
      assert.equal(second.calls, 1, '知らない形式版の記録を信用した');
    } finally {
      second.restore();
    }
  });

  it('publish は一時ファイルを残さない', async () => {
    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      await save(`${uniqueUrl('.png')}`);
    } finally {
      fetchStub.restore();
    }
    for (const dir of [outputDir, metadataDir]) {
      const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'));
      assert.deepEqual(leftovers, [], `${dir} に一時ファイルが残った`);
    }
  });
});

/* ------------------------------------------------------------ 同一性の分離 */

describe('saveImageLocally — 同一性は identity で決まる', () => {
  it('external: クエリが違えば別の成果物になる', async () => {
    // 修正前は origin + pathname だけをハッシュしていたため、この 2 枚が
    // 同じファイルへ潰れ、2 枚目に 1 枚目の中身が出ていた（実測）
    const base = uniqueUrl();
    let n = 0;
    const fetchStub = stubFetch(() => imageResponse('image/png', `PNG-VARIANT-${++n}`));
    try {
      const a = await saveImageLocally(`${base}?id=1`, 'probe', { outputDir, metadataDir, identity: 'full-url' });
      const b = await saveImageLocally(`${base}?id=2`, 'probe', { outputDir, metadataDir, identity: 'full-url' });

      assert.notEqual(a, b, 'クエリ違いが同じ成果物へ潰れた');
      assert.equal(await readFile(path.join(outputDir, path.basename(a)), 'utf-8'), 'PNG-VARIANT-1');
      assert.equal(await readFile(path.join(outputDir, path.basename(b)), 'utf-8'), 'PNG-VARIANT-2');
    } finally {
      fetchStub.restore();
    }
  });

  it('notion-hosted: 署名クエリが変わっても同じ成果物へ収束し、再取得しない', async () => {
    const base = `${uniqueUrl()}/fig.png`;
    const fetchStub = stubFetch(() => imageResponse('image/png', 'SIGNED-PNG'));
    try {
      const a = await saveImageLocally(`${base}?X-Amz-Signature=aaa&X-Amz-Expires=3600`, 'probe', {
        outputDir,
        metadataDir,
        identity: 'origin-path',
      });
      const b = await saveImageLocally(`${base}?X-Amz-Signature=bbb-completely-different`, 'probe', {
        outputDir,
        metadataDir,
        identity: 'origin-path',
      });

      assert.equal(a, b, '署名違いが別の成果物になった');
      assert.equal(fetchStub.calls, 1, '2 回目も取得してしまった');
    } finally {
      fetchStub.restore();
    }
  });

  it('identity が違えば互いの成果物を再利用しない', async () => {
    const url = `${uniqueUrl('.png')}?v=1`;
    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      const asExternal = await saveImageLocally(url, 'probe', { outputDir, metadataDir, identity: 'full-url' });
      const asNotion = await saveImageLocally(url, 'probe', { outputDir, metadataDir, identity: 'origin-path' });
      assert.notEqual(asExternal, asNotion);
      assert.equal(fetchStub.calls, 2, '別 policy の記録を再利用した');
    } finally {
      fetchStub.restore();
    }
  });

  it('既定は full-url（安全側）', async () => {
    const url = `${uniqueUrl('.png')}?v=1`;
    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      const byDefault = await saveImageLocally(url, 'probe', { outputDir, metadataDir });
      const explicit = await saveImageLocally(url, 'probe', { outputDir, metadataDir, identity: 'full-url' });
      assert.equal(byDefault, explicit);
    } finally {
      fetchStub.restore();
    }
  });
});

/* ------------------------------------------------- 壊れた percent 表記の診断 */

describe('saveImageLocally — 壊れた percent 表記を診断できる形で落とす', () => {
  // 以前は decodeURIComponent が素の `URIError: URI malformed` を投げていた。
  // 記事も URL も付かないため、18 記事のビルドで原因の特定ができない
  it('不完全なバイト列 / 単独の % を、URL 付きで説明して落とす', async () => {
    for (const url of ['https://ex.invalid/a%E0%A4.png', 'https://ex.invalid/100%.png']) {
      await assert.rejects(
        saveImageLocally(url, 'scent-of-rain / img9', { outputDir, metadataDir }),
        (error: Error) =>
          !(error instanceof URIError) &&
          /% 表記が壊れています/.test(error.message) &&
          error.message.includes('scent-of-rain / img9') &&
          error.message.includes('ex.invalid'),
        `${url} の診断が不十分`,
      );
    }
  });

  it('診断に署名クエリを出さない', async () => {
    await assert.rejects(
      saveImageLocally('https://ex.invalid/a%E0%A4.png?X-Amz-Signature=SECRET123', 'probe', { outputDir, metadataDir }),
      (error: Error) => !error.message.includes('SECRET123'),
    );
  });

  it('取得より前に落ちる（壊れた URL を fetch しない）', async () => {
    const fetchStub = stubFetch(() => imageResponse('image/png'));
    try {
      await assert.rejects(saveImageLocally('https://ex.invalid/a%E0%A4.png', 'probe', { outputDir, metadataDir }));
      assert.equal(fetchStub.calls, 0);
    } finally {
      fetchStub.restore();
    }
  });
});
