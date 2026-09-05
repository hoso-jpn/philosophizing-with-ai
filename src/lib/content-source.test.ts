import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MissingArticleContentError,
  createPageBodyLoader,
  resolveArticleContentSource,
  type ContentSourceInput,
} from './content-source.ts';
import { PAGE_BODY_MIGRATED_SLUGS, usesPageBodySource } from './migration-allowlist.ts';
import { NotionPageBodyError, type NotionBlock } from './notion-blocks.ts';

const article = (overrides: Partial<ContentSourceInput> = {}): ContentSourceInput => ({
  id: 'page-1',
  slug: 'migrated-post',
  content: '<p>legacy 本文</p>',
  ...overrides,
});

const paragraph = (text: string, id = 'b1'): NotionBlock => ({
  id,
  type: 'paragraph',
  has_children: false,
  paragraph: { rich_text: text ? [{ plain_text: text }] : [] },
});

/** 呼ばれたら失敗させる。allowlist 外で取得しに行っていないことを確かめる用 */
const neverFetch = async (): Promise<NotionBlock[]> => {
  throw new Error('allowlist 外なのにページ本文を取得しに行った');
};

const allowAll = () => true;
const allowNone = () => false;

describe('migration allowlist', () => {
  it('初期値は空。Issue #4 単独では全記事が legacy のまま', () => {
    assert.deepEqual([...PAGE_BODY_MIGRATED_SLUGS], []);
    assert.equal(usesPageBodySource('rtx-5090'), false);
  });
});

describe('resolveArticleContentSource: allowlist 外', () => {
  it('ページ本文があっても legacy Content を使う', async () => {
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: async () => [paragraph('ページ本文')],
      usesPageBody: allowNone,
    });
    assert.deepEqual(source, { kind: 'legacy', content: '<p>legacy 本文</p>' });
  });

  it('ページ本文を取得しに行かない', async () => {
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: neverFetch,
      usesPageBody: allowNone,
    });
    assert.equal(source.kind, 'legacy');
  });
});

describe('resolveArticleContentSource: allowlist 内', () => {
  it('意味のあるページ本文があれば notion-page を選ぶ', async () => {
    const blocks = [paragraph('ページ本文')];
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: async (pageId) => {
        assert.equal(pageId, 'page-1');
        return blocks;
      },
      usesPageBody: allowAll,
    });
    assert.deepEqual(source, { kind: 'notion-page', pageId: 'page-1', blocks });
  });

  it('正常に取得できたが空なら legacy Content へ戻す', async () => {
    for (const blocks of [[], [paragraph('')], [paragraph('   ')]]) {
      const source = await resolveArticleContentSource(article(), {
        fetchPageBlocks: async () => blocks,
        usesPageBody: allowAll,
      });
      assert.deepEqual(source, { kind: 'legacy', content: '<p>legacy 本文</p>' });
    }
  });

  it('divider だけのページ本文は空扱いにしない', async () => {
    const blocks: NotionBlock[] = [{ id: 'd1', type: 'divider', has_children: false, divider: {} }];
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: async () => blocks,
      usesPageBody: allowAll,
    });
    assert.equal(source.kind, 'notion-page');
  });
});

describe('resolveArticleContentSource: API 障害は legacy へ落とさない', () => {
  const failures: [string, unknown][] = [
    ['network error', new TypeError('fetch failed')],
    ['timeout', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })],
    ['429', new Error('Notion API への blocks/page-1/children が失敗しました: 429 Too Many Requests')],
    ['5xx', new Error('Notion API への blocks/page-1/children が失敗しました: 503 Service Unavailable')],
    ['JSON parse error', new SyntaxError('Unexpected token < in JSON at position 0')],
    ['malformed response', new NotionPageBodyError('page-1', '  - results: 配列ではありません')],
  ];

  for (const [label, error] of failures) {
    it(`${label} でも legacy へ戻さず投げる`, async () => {
      await assert.rejects(
        resolveArticleContentSource(article(), {
          fetchPageBlocks: async () => {
            throw error;
          },
          usesPageBody: allowAll,
        }),
        (thrown: unknown) => thrown === error,
      );
    });
  }

  it('legacy Content が健在でも、取得失敗なら投げる（静かに古い本文へ戻さない）', async () => {
    await assert.rejects(
      resolveArticleContentSource(article({ content: '<p>まだ読める legacy 本文</p>' }), {
        fetchPageBlocks: async () => {
          throw new Error('503 Service Unavailable');
        },
        usesPageBody: allowAll,
      }),
      /503/,
    );
  });

  it('ページネーション途中の失敗も投げる', async () => {
    let called = 0;
    const loadPageBody = createPageBodyLoader(async (_blockId, cursor) => {
      called += 1;
      if (cursor === null) return { results: [paragraph('前半')], has_more: true, next_cursor: 'cur-2' };
      throw new Error('Notion API への blocks/page-1/children が失敗しました: 500');
    });

    await assert.rejects(
      resolveArticleContentSource(article(), { fetchPageBlocks: loadPageBody, usesPageBody: allowAll }),
      /500/,
    );
    assert.equal(called, 2);
  });

  it('ページネーション途中で応答が壊れていても投げる', async () => {
    const loadPageBody = createPageBodyLoader(async (_blockId, cursor) =>
      cursor === null
        ? { results: [paragraph('前半')], has_more: true, next_cursor: 'cur-2' }
        : { results: null },
    );

    await assert.rejects(
      resolveArticleContentSource(article(), { fetchPageBlocks: loadPageBody, usesPageBody: allowAll }),
      NotionPageBodyError,
    );
  });
});

describe('resolveArticleContentSource: 本文がどこにも無ければ投げる', () => {
  it('allowlist 内・ページ本文が空・legacy Content も空', async () => {
    await assert.rejects(
      resolveArticleContentSource(article({ content: '' }), {
        fetchPageBlocks: async () => [],
        usesPageBody: allowAll,
      }),
      MissingArticleContentError,
    );
  });

  it('allowlist 内・ページ本文が空・legacy Content が空白のみ', async () => {
    await assert.rejects(
      resolveArticleContentSource(article({ content: '  \n ' }), {
        fetchPageBlocks: async () => [paragraph('')],
        usesPageBody: allowAll,
      }),
      MissingArticleContentError,
    );
  });

  it('allowlist 外で legacy Content が空（parsePost をすり抜けた場合の防波堤）', async () => {
    await assert.rejects(
      resolveArticleContentSource(article({ content: '' }), {
        fetchPageBlocks: neverFetch,
        usesPageBody: allowNone,
      }),
      MissingArticleContentError,
    );
  });

  it('エラー文に slug とページ ID が入る', async () => {
    await assert.rejects(
      resolveArticleContentSource(article({ slug: 'ai-stat-03', id: 'page-xyz', content: '' }), {
        fetchPageBlocks: async () => [],
        usesPageBody: allowAll,
      }),
      (e: Error) => e.message.includes('ai-stat-03') && e.message.includes('page-xyz'),
    );
  });
});

describe('createPageBodyLoader: 1 ビルド 1 スナップショット', () => {
  it('同じページを 2 度取りに行かない', async () => {
    let requests = 0;
    const loadPageBody = createPageBodyLoader(async () => {
      requests += 1;
      return { results: [paragraph('本文')], has_more: false, next_cursor: null };
    });

    const [first, second] = await Promise.all([loadPageBody('page-1'), loadPageBody('page-1')]);
    await loadPageBody('page-1');

    assert.equal(requests, 1);
    assert.equal(first, second);
  });

  it('ページが違えばそれぞれ取得する', async () => {
    const requested: string[] = [];
    const loadPageBody = createPageBodyLoader(async (blockId) => {
      requested.push(blockId);
      return { results: [], has_more: false, next_cursor: null };
    });

    await loadPageBody('page-1');
    await loadPageBody('page-2');
    assert.deepEqual(requested, ['page-1', 'page-2']);
  });

  it('cache: false ならメモ化しない（dev サーバー用）', async () => {
    let requests = 0;
    const loadPageBody = createPageBodyLoader(
      async () => {
        requests += 1;
        return { results: [], has_more: false, next_cursor: null };
      },
      { cache: false },
    );

    await loadPageBody('page-1');
    await loadPageBody('page-1');
    assert.equal(requests, 2);
  });

  it('失敗もキャッシュする（同じビルド内で結果を変えない）', async () => {
    let requests = 0;
    const loadPageBody = createPageBodyLoader(async () => {
      requests += 1;
      throw new Error('503');
    });

    await assert.rejects(loadPageBody('page-1'), /503/);
    await assert.rejects(loadPageBody('page-1'), /503/);
    assert.equal(requests, 1);
  });
});
