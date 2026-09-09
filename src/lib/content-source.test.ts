import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MissingArticleContentError,
  createPageBodyLoader,
  resolveArticleContentSource,
  type ContentSourceInput,
} from './content-source.ts';
import { ArticleUrlPolicyError, assertArticleUrlInvariants } from './article-links.ts';
import {
  RemoteArticleImageError,
  assertNoRemoteArticleImages,
  localizeArticleDocumentMedia,
} from './article-media.ts';
import type { ArticleDocument, ArticleImageBlock } from './article-document.ts';
import {
  PAGE_BODY_MIGRATED_SLUGS,
  UnknownMigratedSlugError,
  findUnknownMigratedSlugs,
  usesPageBodySource,
} from './migration-allowlist.ts';
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
  it('Issue #8 の canary だけを page body へ移行する', () => {
    assert.deepEqual([...PAGE_BODY_MIGRATED_SLUGS], ['allrounder-or-master-gxe-selection']);
    assert.equal(usesPageBodySource('allrounder-or-master-gxe-selection'), true);
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
    // 生ブロックではなく正規化済みの ArticleDocument を持つ（Issue #5）
    assert.equal(source.kind, 'notion-page');
    assert.deepEqual(source, {
      kind: 'notion-page',
      pageId: 'page-1',
      document: {
        blocks: [
          {
            kind: 'paragraph',
            id: 'b1',
            richText: [
              {
                kind: 'text',
                text: 'ページ本文',
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                href: null,
              },
            ],
          },
        ],
      },
    });
    assert.ok(!('blocks' in source), 'source が生ブロックを持ち出している');
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


describe('ページ本文の不変条件が暫定 guard を置き換えている（Issue #6）', () => {
  const docWith = (blocks: ArticleDocument['blocks']): ArticleDocument => ({ blocks });
  const link = (href: string) => ({
    kind: 'text' as const,
    text: 'ラベル',
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    href,
  });
  const imageBlock = (source: ArticleImageBlock['source']): ArticleImageBlock => ({
    kind: 'image',
    id: 'img-1',
    source,
    caption: [{ ...link(''), href: null, text: '図1 概要' }],
    alt: null,
  });

  it('#4 の暫定 guard は削除されている（フラグではなく実検査になった）', async () => {
    // フラグを true にするだけの解除を許さないため、export ごと消えていること
    const module = (await import('./content-source.ts')) as Record<string, unknown>;
    assert.equal(module.PAGE_BODY_INVARIANTS_IMPLEMENTED, undefined);
    assert.equal(module.assertPageBodySourcesAreGuarded, undefined);
    assert.equal(module.UnguardedPageBodySourceError, undefined);
  });

  it('ページ本文の自サイト絶対 URL でビルドが落ちる', () => {
    assert.throws(
      () =>
        assertArticleUrlInvariants(
          docWith([{ kind: 'paragraph', id: 'p1', richText: [link('https://blog.florigen.ai/posts/x')] }]),
          { slug: 'migrated-post' },
        ),
      ArticleUrlPolicyError,
    );
  });

  it('ローカル化していない画像が残っていたら落ちる（事後条件）', () => {
    assert.throws(
      () =>
        assertNoRemoteArticleImages(
          docWith([imageBlock({ kind: 'notion-hosted', url: 'https://s3.example/x.svg?sig=a', expiryTime: null })]),
          { slug: 'migrated-post' },
        ),
      RemoteArticleImageError,
    );
  });

  it('ローカル化を通したページ本文は両方の検査を通る', async () => {
    const document = docWith([
      { kind: 'paragraph', id: 'p1', richText: [link('/posts/other')] },
      imageBlock({ kind: 'notion-hosted', url: 'https://s3.example/fig.svg?sig=a', expiryTime: null }),
    ]);

    assert.doesNotThrow(() => assertArticleUrlInvariants(document, { slug: 'migrated-post' }));

    const localized = await localizeArticleDocumentMedia(document, { slug: 'migrated-post' }, {
      localize: async () => '/notion-static/abc.svg',
    });
    assert.doesNotThrow(() => assertNoRemoteArticleImages(localized, { slug: 'migrated-post' }));
  });

  it('legacy source の記事はページ本文の検査を通らない（既存経路は不変）', async () => {
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: neverFetch,
      usesPageBody: allowNone,
    });
    assert.deepEqual(source, { kind: 'legacy', content: '<p>legacy 本文</p>' });
  });
});

describe('findUnknownMigratedSlugs: allowlist の綴り違い・取り残しを見つける', () => {
  const published = ['determinism-free-will-ai', 'ai-stats-03', 'scent-of-rain'];

  it('allowlist が空なら何も報告しない', () => {
    assert.deepEqual(findUnknownMigratedSlugs(published, []), []);
  });

  it('公開記事に存在する slug は通る', () => {
    assert.deepEqual(findUnknownMigratedSlugs(published, ['ai-stats-03']), []);
    assert.deepEqual(
      findUnknownMigratedSlugs(published, ['ai-stats-03', 'scent-of-rain']),
      [],
    );
  });

  it('公開記事に無い slug を報告する', () => {
    assert.deepEqual(findUnknownMigratedSlugs(published, ['ai-stats-3']), ['ai-stats-3']);
    assert.deepEqual(
      findUnknownMigratedSlugs(published, ['ai-stats-03', 'typo-slug']),
      ['typo-slug'],
    );
  });

  it('綴りを補正しない（完全一致のみ）', () => {
    // 大文字小文字・前後の空白・部分一致はいずれも別物として扱う。
    // 曖昧一致を入れると、意図しない記事がページ本文へ切り替わる余地ができる
    for (const near of ['AI-Stats-03', ' ai-stats-03', 'ai-stats-03 ', 'ai-stats']) {
      assert.deepEqual(findUnknownMigratedSlugs(published, [near]), [near]);
    }
  });

  it('既定では版管理された canary allowlist を見る', () => {
    assert.deepEqual(findUnknownMigratedSlugs(published), ['allrounder-or-master-gxe-selection']);
    assert.deepEqual(
      findUnknownMigratedSlugs([...published, 'allrounder-or-master-gxe-selection']),
      [],
    );
  });

  it('エラー文に該当 slug と考えられる原因が入る', () => {
    const error = new UnknownMigratedSlugError(['ai-stats-3']);
    assert.match(error.message, /ai-stats-3/);
    assert.match(error.message, /migration-allowlist/);
    assert.match(error.message, /Published/);
    assert.equal(error.name, 'UnknownMigratedSlugError');
  });
});

describe('Issue #5 後も #4 の安全契約が効いている', () => {
  it('migration allowlist は Issue #8 の canary 1件だけ', () => {
    assert.deepEqual([...PAGE_BODY_MIGRATED_SLUGS], ['allrounder-or-master-gxe-selection']);
  });

  it('ページ本文の source は取得の段で不変条件に掛かる', async () => {
    // #4 の暫定 guard は Issue #6 で実検査へ置き換わった。安全性が
    // [slug].astro にも暫定フラグにも依存していないことをデータ層だけで確かめる
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: async () => [paragraph('ページ本文')],
      usesPageBody: allowAll,
    });
    assert.equal(source.kind, 'notion-page');

    // 違反があれば落ち、無ければ通る。どちらも取得の段で決まる
    if (source.kind !== 'notion-page') throw new Error('unreachable');
    assert.doesNotThrow(() => assertArticleUrlInvariants(source.document, { slug: 'migrated-post' }));
    assert.doesNotThrow(() => assertNoRemoteArticleImages(source.document, { slug: 'migrated-post' }));
  });

  it('legacy 記事はページ本文の検査対象にならない（既存記事の経路は変わらない）', async () => {
    const source = await resolveArticleContentSource(article(), {
      fetchPageBlocks: neverFetch,
      usesPageBody: allowNone,
    });
    assert.deepEqual(source, { kind: 'legacy', content: '<p>legacy 本文</p>' });
  });

  it('正規化で未対応ブロックに当たっても legacy へ落ちない', async () => {
    // 「本文が空だった」と取り違えて古い本文へ戻さない。#4 と同じ方針
    await assert.rejects(
      resolveArticleContentSource(article({ content: '<p>まだ読める legacy 本文</p>' }), {
        fetchPageBlocks: async () => [
          { id: 'b1', type: 'synced_block', has_children: false, synced_block: {} },
        ],
        usesPageBody: allowAll,
      }),
      /synced_block/,
    );
  });
});
