import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildFileName } from './download-image.ts';

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
