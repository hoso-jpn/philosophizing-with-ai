import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ArticleImageError,
  RemoteArticleImageError,
  altFromCaption,
  assertNoRemoteArticleImages,
  localizeArticleDocumentMedia,
  svgTitle,
} from './article-media.ts';
import { collectArticleImages } from './article-document.ts';
import type { ArticleBlock, ArticleDocument, ArticleImageBlock, ArticleRichText } from './article-document.ts';

/* ------------------------------------------------------------------ fixtures */

const text = (value: string, href: string | null = null): Extract<ArticleRichText, { kind: 'text' }> => ({
  kind: 'text',
  text: value,
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  href,
});

const image = (
  id: string,
  source: ArticleImageBlock['source'],
  caption: string | null = '図の説明',
): ArticleImageBlock => ({
  kind: 'image',
  id,
  source,
  caption: caption === null ? [] : [text(caption)],
  alt: null,
});

const notionHosted = (pathname: string, signature: string) => ({
  kind: 'notion-hosted' as const,
  // 実際の署名付き URL はハードコードしない。形だけ同じ合成 URL を使う
  url: `https://prod-files-secure.s3.us-west-2.amazonaws.com${pathname}?X-Amz-Signature=${signature}&X-Amz-Expires=3600`,
  expiryTime: '2026-09-06T00:00:00.000Z',
});

const doc = (blocks: ArticleBlock[]): ArticleDocument => ({ blocks });

/** 呼ばれた URL を記録しつつ、決め打ちのローカルパスを返す */
function recordingLocalizer(map: Record<string, string> = {}) {
  const calls: string[] = [];
  return {
    calls,
    localize: async (url: string) => {
      calls.push(url);
      const key = new URL(url).pathname;
      return map[key] ?? `/notion-static${key.replace(/[^a-z0-9.]/gi, '')}`;
    },
  };
}

const ctx = { slug: 'ai-stats-03' };

/* ---------------------------------------------------------------------- alt */

describe('altFromCaption', () => {
  it('caption をそのまま alt にする', () => {
    assert.equal(altFromCaption('図1 AMMI モデルの構造'), '図1 AMMI モデルの構造');
  });

  it('空白を畳む', () => {
    assert.equal(altFromCaption('  図1   AMMI\n  モデル  '), '図1 AMMI モデル');
  });

  it('空・空白のみなら null', () => {
    assert.equal(altFromCaption(''), null);
    assert.equal(altFromCaption('   \n\t'), null);
  });

  it('長い caption は途中で切って省略記号を付ける（読み上げが冗長になるため）', () => {
    const long = `${'あ'.repeat(200)}`;
    const alt = altFromCaption(long)!;
    assert.ok(alt.length <= 121, `長すぎる: ${alt.length}`);
    assert.ok(alt.endsWith('…'));
  });

  it('区切りがあれば語の途中で切らない', () => {
    const long = `${'図の説明。'.repeat(30)}`;
    const alt = altFromCaption(long)!;
    assert.ok(alt.endsWith('…'));
    assert.ok(alt.length < long.length);
  });
});

describe('svgTitle', () => {
  it('title を読む', () => {
    assert.equal(svgTitle('<svg><title>収量の分布</title><g/></svg>'), '収量の分布');
  });

  it('属性つき title / 前後の空白も読む', () => {
    assert.equal(svgTitle('<svg><title id="t">  収量  </title></svg>'), '収量');
  });

  it('title が無ければ null', () => {
    assert.equal(svgTitle('<svg><g/></svg>'), null);
    assert.equal(svgTitle('<svg><title></title></svg>'), null);
  });
});

/* ----------------------------------------------------------- localization */

describe('localizeArticleDocumentMedia', () => {
  it('notion-hosted の署名付き URL をローカルパスへ置き換える', async () => {
    const recorder = recordingLocalizer({ '/x/fig1.svg': '/notion-static/aaa.svg' });
    const result = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/x/fig1.svg', 'sig-a'))]),
      ctx,
      { localize: recorder.localize },
    );

    const [localized] = collectArticleImages(result);
    assert.deepEqual(localized.source, { kind: 'local', src: '/notion-static/aaa.svg' });
    assert.equal(localized.alt, '図の説明');
  });

  it('external の画像もローカル化する（remote を HTML へ残さない）', async () => {
    const recorder = recordingLocalizer({ '/a.png': '/notion-static/bbb.png' });
    const result = await localizeArticleDocumentMedia(
      doc([image('i1', { kind: 'external', url: 'https://example.com/a.png' })]),
      ctx,
      { localize: recorder.localize },
    );
    assert.deepEqual(collectArticleImages(result)[0].source, {
      kind: 'local',
      src: '/notion-static/bbb.png',
    });
  });

  it('署名クエリが変わっても同じ画像は同じ扱いになる（安定ファイル名は既存実装が担保）', async () => {
    const recorder = recordingLocalizer({ '/x/fig1.svg': '/notion-static/aaa.svg' });
    const a = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/x/fig1.svg', 'sig-a'))]),
      ctx,
      { localize: recorder.localize },
    );
    const b = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/x/fig1.svg', 'sig-b-completely-different'))]),
      ctx,
      { localize: recorder.localize },
    );
    assert.deepEqual(collectArticleImages(a)[0].source, collectArticleImages(b)[0].source);
  });

  it('入れ子（callout / quote / リスト項目）の画像も取り込む', async () => {
    const recorder = recordingLocalizer();
    const result = await localizeArticleDocumentMedia(
      doc([
        { kind: 'callout', id: 'c', richText: [], icon: null, children: [image('i1', notionHosted('/c.svg', 's'))] },
        { kind: 'quote', id: 'q', richText: [], children: [image('i2', notionHosted('/q.svg', 's'))] },
        {
          kind: 'list',
          ordered: false,
          items: [{ id: 'li', richText: [], children: [image('i3', notionHosted('/l.svg', 's'))] }],
        },
      ]),
      ctx,
      { localize: recorder.localize },
    );

    const images = collectArticleImages(result);
    assert.equal(images.length, 3);
    for (const img of images) assert.equal(img.source.kind, 'local');
    assert.equal(recorder.calls.length, 3);
  });

  it('取得に失敗したら握り潰さず投げる（画像を無かったことにしない）', async () => {
    const failure = new Error('画像を取得できませんでした: 404 Not Found');
    await assert.rejects(
      localizeArticleDocumentMedia(doc([image('i1', notionHosted('/x.svg', 's'))]), ctx, {
        localize: async () => {
          throw failure;
        },
      }),
      (thrown: unknown) => thrown === failure,
    );
  });

  it('ローカルパスにならない結果を素通しさせない', async () => {
    // saveImageLocally は http(s) 以外を素通しする設計。本文画像でそれが起きたら異常
    await assert.rejects(
      localizeArticleDocumentMedia(doc([image('i1', { kind: 'external', url: 'ftp://x/y.png' })]), ctx, {
        localize: async (url) => url,
      }),
      ArticleImageError,
    );
  });

  it('署名やトークンをエラー文へ出さない', async () => {
    await assert.rejects(
      localizeArticleDocumentMedia(
        doc([image('i1', { kind: 'external', url: 'ftp://x/y.png?X-Amz-Signature=SECRET123' })]),
        ctx,
        { localize: async (url) => url },
      ),
      (e: Error) => !e.message.includes('SECRET123') && e.message.includes('/y.png'),
    );
  });

  it('既にローカル化済みなら再取得しない', async () => {
    const recorder = recordingLocalizer();
    await localizeArticleDocumentMedia(
      doc([image('i1', { kind: 'local', src: '/notion-static/done.svg' })]),
      ctx,
      { localize: recorder.localize },
    );
    assert.deepEqual(recorder.calls, []);
  });
});

describe('localizeArticleDocumentMedia: alt の決め方', () => {
  it('caption があれば caption から作る', async () => {
    const result = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/a.svg', 's'), '図3 交互作用の主成分')]),
      ctx,
      { localize: async () => '/notion-static/a.svg', readTitle: async () => 'SVG の title' },
    );
    // caption が優先。SVG の title は caption が無いときの拠り所
    assert.equal(collectArticleImages(result)[0].alt, '図3 交互作用の主成分');
  });

  it('caption が無ければ SVG の title を使う', async () => {
    const result = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/a.svg', 's'), null)]),
      ctx,
      { localize: async () => '/notion-static/a.svg', readTitle: async () => '収量の分布' },
    );
    assert.equal(collectArticleImages(result)[0].alt, '収量の分布');
  });

  it('どちらも無ければ落とす（科学図を alt="" で装飾扱いしない）', async () => {
    await assert.rejects(
      localizeArticleDocumentMedia(doc([image('i1', notionHosted('/a.svg', 's'), null)]), ctx, {
        localize: async () => '/notion-static/a.svg',
        readTitle: async () => null,
      }),
      (e: Error) => e instanceof ArticleImageError && e.message.includes('代替テキスト'),
    );
  });

  it('alt に HTML が混ざっても文字として保つ（エスケープは描画側の責務）', async () => {
    const result = await localizeArticleDocumentMedia(
      doc([image('i1', notionHosted('/a.svg', 's'), '<script>alert(1)</script>')]),
      ctx,
      { localize: async () => '/notion-static/a.svg' },
    );
    assert.equal(collectArticleImages(result)[0].alt, '<script>alert(1)</script>');
  });
});

/* ------------------------------------------------------------ post-condition */

describe('assertNoRemoteArticleImages', () => {
  it('すべて local なら通る', () => {
    assert.doesNotThrow(() =>
      assertNoRemoteArticleImages(doc([image('i1', { kind: 'local', src: '/notion-static/a.svg' })]), ctx),
    );
  });

  it('画像が無くても通る', () => {
    assert.doesNotThrow(() => assertNoRemoteArticleImages(doc([]), ctx));
  });

  it('notion-hosted が残っていたら落とす', () => {
    assert.throws(
      () => assertNoRemoteArticleImages(doc([image('i1', notionHosted('/a.svg', 's'))]), ctx),
      RemoteArticleImageError,
    );
  });

  it('external が残っていたら落とす', () => {
    assert.throws(
      () => assertNoRemoteArticleImages(doc([image('i1', { kind: 'external', url: 'https://e/a.png' })]), ctx),
      RemoteArticleImageError,
    );
  });

  it('入れ子に 1 件でも残っていれば見つける', () => {
    assert.throws(
      () =>
        assertNoRemoteArticleImages(
          doc([
            image('ok', { kind: 'local', src: '/notion-static/a.svg' }),
            { kind: 'callout', id: 'c', richText: [], icon: null, children: [image('bad', notionHosted('/b.svg', 's'))] },
          ]),
          ctx,
        ),
      RemoteArticleImageError,
    );
  });

  it('エラー文に署名を出さない', () => {
    assert.throws(
      () => assertNoRemoteArticleImages(doc([image('i1', notionHosted('/a.svg', 'SECRET123'))]), ctx),
      (e: Error) => !e.message.includes('SECRET123') && e.message.includes('/a.svg'),
    );
  });
});

/* --------------------------------------------------- canary 相当のフィクスチャ */

describe('AIと統計学03 相当の本文（SVG 6 枚 + caption + リンク）', () => {
  /** 実 Notion の署名付き URL はハードコードしない。形だけ同じ合成 URL */
  const canary = (): ArticleDocument =>
    doc([
      { kind: 'heading', id: 'h1', level: 1, richText: [text('AMMI モデル')] },
      ...Array.from({ length: 6 }, (_, i) =>
        image(`fig-${i + 1}`, notionHosted(`/figs/fig${i + 1}.svg`, `sig-${i}`), `図${i + 1} 説明`),
      ),
      {
        kind: 'paragraph',
        id: 'p1',
        richText: [text('参考文献', 'https://doi.org/10.1111/x')],
      },
    ]);

  it('6 枚すべてが local になり、事後条件を通る', async () => {
    const recorder = recordingLocalizer();
    const result = await localizeArticleDocumentMedia(canary(), ctx, { localize: recorder.localize });

    const images = collectArticleImages(result);
    assert.equal(images.length, 6);
    assert.deepEqual(
      images.map((img) => img.source.kind),
      Array(6).fill('local'),
    );
    assert.deepEqual(
      images.map((img) => img.alt),
      ['図1 説明', '図2 説明', '図3 説明', '図4 説明', '図5 説明', '図6 説明'],
    );
    assert.doesNotThrow(() => assertNoRemoteArticleImages(result, ctx));
  });

  it('ローカル化前の本文は事後条件で落ちる', () => {
    assert.throws(() => assertNoRemoteArticleImages(canary(), ctx), RemoteArticleImageError);
  });

  it('6 枚それぞれを 1 回ずつ取りに行く', async () => {
    const recorder = recordingLocalizer();
    await localizeArticleDocumentMedia(canary(), ctx, { localize: recorder.localize });
    assert.equal(recorder.calls.length, 6);
    assert.equal(new Set(recorder.calls.map((u) => new URL(u).pathname)).size, 6);
  });
});
