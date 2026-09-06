import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DeferredArticleBlockError,
  assertArticleDocumentRenderable,
  decorationTags,
} from './article-document.ts';
import type { ArticleBlock, ArticleRichText, DecorationTag } from './article-document.ts';
import { safeHref } from './content-links.ts';

const textNode = (overrides: Partial<Extract<ArticleRichText, { kind: 'text' }>> = {}): ArticleRichText => ({
  kind: 'text',
  text: 'x',
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  href: null,
  ...overrides,
});

const paragraph = (id = 'p1'): ArticleBlock => ({ kind: 'paragraph', id, richText: [textNode()] });

describe('decorationTags: 装飾の入れ子順を 1 か所に固定する', () => {
  it('装飾が無ければタグも無い', () => {
    assert.deepEqual(decorationTags(textNode()), []);
  });

  it('内側から外側の順に返す', () => {
    assert.deepEqual(decorationTags(textNode({ bold: true })), ['strong']);
    assert.deepEqual(decorationTags(textNode({ italic: true })), ['em']);
    assert.deepEqual(decorationTags(textNode({ strikethrough: true })), ['del']);
    assert.deepEqual(decorationTags(textNode({ underline: true })), ['u']);
    assert.deepEqual(decorationTags(textNode({ code: true })), ['code']);
  });

  it('code は最も内側、bold は最も外側', () => {
    // <strong><code>…</code></strong>。コードの中身が装飾の一部として
    // 解釈されないよう code を内側に置く
    assert.deepEqual(decorationTags(textNode({ bold: true, code: true })), ['code', 'strong']);
  });

  it('全部盛りでも順序が決まっている', () => {
    assert.deepEqual(
      decorationTags(textNode({ bold: true, italic: true, strikethrough: true, underline: true, code: true })),
      ['code', 'u', 'del', 'em', 'strong'],
    );
  });

  it('数式ノードには装飾を付けない', () => {
    assert.deepEqual(decorationTags({ kind: 'equation', expression: 'x' }), []);
  });
});

describe('assertArticleDocumentRenderable: 描けないものを黙って飛ばさない', () => {
  const renderable: ArticleBlock[] = [
    paragraph(),
    { kind: 'heading', id: 'h', level: 2, richText: [] },
    { kind: 'divider', id: 'd' },
    { kind: 'code', id: 'c', code: 'x', language: null, caption: [] },
    { kind: 'list', ordered: false, items: [{ id: 'i', richText: [], children: [] }] },
    { kind: 'quote', id: 'q', richText: [], children: [] },
    { kind: 'callout', id: 'k', richText: [], icon: null, children: [] },
  ];

  it('今回対応した種別だけなら通る', () => {
    assert.doesNotThrow(() => assertArticleDocumentRenderable({ blocks: renderable }));
  });

  it('空の document も通る', () => {
    assert.doesNotThrow(() => assertArticleDocumentRenderable({ blocks: [] }));
  });

  const deferred: [string, ArticleBlock, string][] = [
    ['image', { kind: 'image', id: 'img', source: { kind: 'external', url: 'https://e/a.png' }, caption: [], alt: null }, 'Issue #6'],
    ['equation', { kind: 'equation', id: 'eq', expression: 'x^2' }, 'Issue #7'],
    ['table', { kind: 'table', id: 'tb', hasColumnHeader: true, hasRowHeader: false, rows: [] }, 'Issue #7'],
  ];

  for (const [label, blockValue, issue] of deferred) {
    it(`${label} は ${issue} を案内して落ちる`, () => {
      assert.throws(
        () => assertArticleDocumentRenderable({ blocks: [blockValue] }, { slug: 'ai-stats-03' }),
        (e: Error) =>
          e instanceof DeferredArticleBlockError &&
          e.message.includes(label) &&
          e.message.includes(issue) &&
          e.message.includes('ai-stats-03'),
      );
    });
  }

  it('リストの入れ子に隠れた未対応ブロックも見つける', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable({
          blocks: [
            {
              kind: 'list',
              ordered: false,
              items: [
                {
                  id: 'i',
                  richText: [],
                  children: [{ kind: 'equation', id: 'eq', expression: 'x' }],
                },
              ],
            },
          ],
        }),
      DeferredArticleBlockError,
    );
  });

  it('quote / callout の子に隠れた未対応ブロックも見つける', () => {
    for (const parent of [
      { kind: 'quote', id: 'q', richText: [], children: [{ kind: 'table', id: 't', hasColumnHeader: false, hasRowHeader: false, rows: [] }] },
      { kind: 'callout', id: 'k', richText: [], icon: null, children: [{ kind: 'image', id: 'i', source: { kind: 'external', url: 'https://e/a.png' }, caption: [], alt: null }] },
    ] as ArticleBlock[]) {
      assert.throws(() => assertArticleDocumentRenderable({ blocks: [parent] }), DeferredArticleBlockError);
    }
  });

  it('対応済みブロックに混ざった 1 件でも見逃さない', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable({
          blocks: [...renderable, { kind: 'equation', id: 'eq', expression: 'x' }, paragraph('p2')],
        }),
      DeferredArticleBlockError,
    );
  });
});

describe('safeHref: 危険なスキームを出さない', () => {
  it('http / https / mailto を通す', () => {
    assert.equal(safeHref('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d');
    assert.equal(safeHref('http://example.com'), 'http://example.com');
    assert.equal(safeHref('mailto:a@example.com'), 'mailto:a@example.com');
  });

  it('相対パスをそのまま通す（内部リンクは相対で書く決まり）', () => {
    assert.equal(safeHref('/posts/example'), '/posts/example');
    assert.equal(safeHref('#section'), '#section');
    assert.equal(safeHref('../a/b'), '../a/b');
    assert.equal(safeHref('?q=1'), '?q=1');
  });

  it('javascript: を通さない（大文字・空白・混在も）', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      '  javascript:alert(1)  ',
      'java\tscript:alert(1)',
    ]) {
      assert.equal(safeHref(href), null, `${JSON.stringify(href)} を通した`);
    }
  });

  it('data: / vbscript: / file: も通さない', () => {
    assert.equal(safeHref('data:text/html;base64,PHNjcmlwdD4='), null);
    assert.equal(safeHref('vbscript:msgbox(1)'), null);
    assert.equal(safeHref('file:///etc/passwd'), null);
  });

  it('空・null・非文字列は null', () => {
    assert.equal(safeHref(''), null);
    assert.equal(safeHref('   '), null);
    assert.equal(safeHref(null), null);
    assert.equal(safeHref(undefined), null);
    assert.equal(safeHref(42 as unknown as string), null);
  });
});

describe('safeHref: ブラウザの URL 前処理を踏まえた回避を通さない', () => {
  it('スキームの途中に制御文字を挟む形を弾く', () => {
    // ブラウザはタブ・改行・復帰を取り除いてから解釈するため、
    // これらはいずれも javascript: として実行される
    for (const href of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      '\tjavascript:alert(1)',
      'java\u0000script:alert(1)',
    ]) {
      assert.equal(safeHref(href), null, `${JSON.stringify(href)} を通した`);
    }
  });

  it('制御文字を含む相対パスも弾く', () => {
    assert.equal(safeHref('/posts/exa\tmple'), null);
  });
});

describe('assertArticleDocumentRenderable: rich text 内のインライン数式も記事単位で拾う', () => {
  const equation: ArticleRichText = { kind: 'equation', expression: 'y_{ij} = \\mu + g_i' };
  const plain = textNode({ text: '式は ' });

  /** 診断に slug・ブロック ID・担当 Issue が揃っているか */
  const hasFullDiagnostics = (blockId: string) => (e: Error) =>
    e instanceof DeferredArticleBlockError &&
    e.message.includes('ai-stats-03') &&
    e.message.includes(blockId) &&
    e.message.includes('Issue #7') &&
    e.message.includes('equation');

  it('段落の中のインライン数式で落ちる', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          { blocks: [{ kind: 'paragraph', id: 'p1', richText: [plain, equation] }] },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('p1'),
    );
  });

  it('見出しの中のインライン数式で落ちる', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          { blocks: [{ kind: 'heading', id: 'h1', level: 2, richText: [equation] }] },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('h1'),
    );
  });

  it('リスト項目のインライン数式で落ちる（項目 ID を出す）', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          {
            blocks: [
              { kind: 'list', ordered: false, items: [{ id: 'li1', richText: [equation], children: [] }] },
            ],
          },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('li1'),
    );
  });

  it('入れ子のリスト項目に隠れたインライン数式も見つける', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          {
            blocks: [
              {
                kind: 'list',
                ordered: false,
                items: [
                  {
                    id: 'li1',
                    richText: [plain],
                    children: [
                      {
                        kind: 'list',
                        ordered: true,
                        items: [{ id: 'li2', richText: [equation], children: [] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('li2'),
    );
  });

  it('callout / quote の本文と子のインライン数式で落ちる', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          { blocks: [{ kind: 'callout', id: 'c1', richText: [equation], icon: null, children: [] }] },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('c1'),
    );
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          {
            blocks: [
              {
                kind: 'quote',
                id: 'q1',
                richText: [plain],
                children: [{ kind: 'paragraph', id: 'q1a', richText: [equation] }],
              },
            ],
          },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('q1a'),
    );
  });

  it('code の caption のインライン数式で落ちる', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable(
          { blocks: [{ kind: 'code', id: 'cd1', code: 'x', language: null, caption: [equation] }] },
          { slug: 'ai-stats-03' },
        ),
      hasFullDiagnostics('cd1'),
    );
  });

  it('インライン数式は「ブロック」とは書かない（#8 でどちらか分かる必要がある）', () => {
    assert.throws(
      () =>
        assertArticleDocumentRenderable({
          blocks: [{ kind: 'paragraph', id: 'p1', richText: [equation] }],
        }),
      (e: Error) => e.message.includes('インライン equation') && !e.message.includes('equation ブロック'),
    );
  });

  it('数式を含まない本文は通る', () => {
    assert.doesNotThrow(() =>
      assertArticleDocumentRenderable({
        blocks: [
          { kind: 'paragraph', id: 'p1', richText: [plain] },
          { kind: 'heading', id: 'h1', level: 3, richText: [textNode({ text: '見出し' })] },
          { kind: 'code', id: 'cd', code: 'x', language: 'ts', caption: [textNode()] },
          {
            kind: 'list',
            ordered: true,
            items: [{ id: 'li', richText: [plain], children: [{ kind: 'divider', id: 'd' }] }],
          },
        ],
      }),
    );
  });
});

describe('decorationTags: 戻り値が閉じた union に収まる', () => {
  it('Notion 由来の文字列をタグ名にできない（型で閉じている）', () => {
    const tags: DecorationTag[] = decorationTags(
      textNode({ bold: true, italic: true, strikethrough: true, underline: true, code: true }),
    );
    const allowed: DecorationTag[] = ['code', 'u', 'del', 'em', 'strong'];
    for (const tag of tags) assert.ok(allowed.includes(tag), `${tag} は許可タグに無い`);
    assert.deepEqual(tags, allowed);
  });
});
