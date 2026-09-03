import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildFileName, localizeContentImages, saveImageLocally } from './download-image.ts';

describe('buildFileName — 署名が変わってもファイル名が変わらないこと', () => {
  // Notion の HeroImage は取得のたびに X-Amz-Signature 等が変わる。
  // URL 全体をハッシュすると毎ビルドで別名になり、public/notion-static が
  // 際限なく増えてビルドキャッシュも効かなくなる。
  const base = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/84cd3f39/b7e03953/hero.png';

  it('クエリだけが違う URL は同じファイル名になる', () => {
    const a = new URL(`${base}?X-Amz-Date=20260902T180010Z&X-Amz-Signature=aaa&X-Amz-Expires=3600`);
    const b = new URL(`${base}?X-Amz-Date=20260903T090000Z&X-Amz-Signature=bbb&X-Amz-Expires=3600`);
    assert.equal(buildFileName(a, '.png'), buildFileName(b, '.png'));
  });

  it('パスが違えば別のファイル名になる', () => {
    const a = new URL('https://example.com/a/hero.png');
    const b = new URL('https://example.com/b/hero.png');
    assert.notEqual(buildFileName(a, '.png'), buildFileName(b, '.png'));
  });

  it('ホストが違えば別のファイル名になる', () => {
    const a = new URL('https://example.com/hero.png');
    const b = new URL('https://other.example/hero.png');
    assert.notEqual(buildFileName(a, '.png'), buildFileName(b, '.png'));
  });

  it('拡張子が付き、ファイル名として安全な文字だけになる', () => {
    // 日本語ファイル名の画像（旧ドメインの本文画像）でも壊れないこと
    const url = new URL('https://example.com/uploads/ホソヘリ2齢-1024x768.jpg');
    const name = buildFileName(url, '.jpg');
    assert.match(name, /^[0-9a-f]{16}\.jpg$/);
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
