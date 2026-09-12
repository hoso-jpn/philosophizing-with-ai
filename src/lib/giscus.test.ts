import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveGiscusConfig } from './giscus.ts';

describe('giscus activation', () => {
  it('設定前は外部コメント欄を出さない', () => {
    assert.equal(resolveGiscusConfig({}), null);
    assert.equal(resolveGiscusConfig({ PUBLIC_GISCUS_CATEGORY: ' ' }), null);
  });
  it('設定漏れ・数値IDの取り違いは有効化しない', () => {
    for (const env of [
      { PUBLIC_GISCUS_CATEGORY: 'Announcements' },
      { PUBLIC_GISCUS_CATEGORY_ID: 'DIC_example' },
      { PUBLIC_GISCUS_CATEGORY: 'Announcements', PUBLIC_GISCUS_CATEGORY_ID: '12345' },
    ]) assert.throws(() => resolveGiscusConfig(env), /両方設定/);
  });
  it('取得済みのrepository node IDと指定categoryを使用する', () => {
    const config = resolveGiscusConfig({
      PUBLIC_GISCUS_CATEGORY: ' Announcements ', PUBLIC_GISCUS_CATEGORY_ID: ' DIC_example ',
    });
    assert.equal(config?.repoId, 'R_kgDORl9JSg');
    assert.equal(config?.category, 'Announcements');
    assert.equal(config?.categoryId, 'DIC_example');
  });
});
