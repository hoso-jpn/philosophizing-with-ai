import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChildBlockFetcher } from './notion-normalize.ts';
import {
  MalformedNotionBlockError,
  UnsupportedNotionBlockError,
  buildArticleDocument,
  normalizeBlocks,
  plainTextOf,
} from './notion-normalize.ts';
import type { NotionBlock } from './notion-blocks.ts';
import type { ArticleBlock, ArticleRichText } from './article-document.ts';

/* ------------------------------------------------------------------ fixtures */

let nextId = 0;
const id = () => `block-${++nextId}`;

/** 装飾なしの text 断片 */
const text = (content: string, extra: Record<string, unknown> = {}) => ({
  type: 'text',
  plain_text: content,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false },
  href: null,
  ...extra,
});

const annotated = (content: string, annotations: Record<string, boolean>, href: string | null = null) => ({
  type: 'text',
  plain_text: content,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, ...annotations },
  href,
});

const block = (type: string, payload: unknown, extra: Record<string, unknown> = {}): NotionBlock => ({
  id: id(),
  type,
  has_children: false,
  [type]: payload,
  ...extra,
});

const paragraph = (content: string) => block('paragraph', { rich_text: [text(content)] });
const bullet = (content: string, extra: Record<string, unknown> = {}) =>
  block('bulleted_list_item', { rich_text: [text(content)] }, extra);
const numbered = (content: string, extra: Record<string, unknown> = {}) =>
  block('numbered_list_item', { rich_text: [text(content)] }, extra);

const noChildren = async (): Promise<NotionBlock[]> => {
  throw new Error('子ブロックを取りに行くべきではありません');
};

const ctx = (fetchChildren: ChildBlockFetcher = noChildren) => ({
  slug: 'test-article',
  pageId: 'page-1',
  fetchChildren,
});

const normalize = (blocks: NotionBlock[], fetchChildren?: ChildBlockFetcher) =>
  normalizeBlocks(blocks, ctx(fetchChildren));

/* -------------------------------------------------------------- block kinds */

describe('normalizeBlocks: 基本ブロック', () => {
  it('paragraph を正規化する', async () => {
    const [node] = await normalize([paragraph('本文です')]);
    assert.equal(node.kind, 'paragraph');
    assert.deepEqual(plainTextOf((node as Extract<ArticleBlock, { kind: 'paragraph' }>).richText), '本文です');
  });

  it('heading_1 / heading_2 / heading_3 を level へ写す', async () => {
    const nodes = await normalize([
      block('heading_1', { rich_text: [text('大見出し')] }),
      block('heading_2', { rich_text: [text('中見出し')] }),
      block('heading_3', { rich_text: [text('小見出し')] }),
    ]);
    assert.deepEqual(
      nodes.map((n) => [n.kind, (n as Extract<ArticleBlock, { kind: 'heading' }>).level]),
      [['heading', 1], ['heading', 2], ['heading', 3]],
    );
  });

  it('divider を正規化する', async () => {
    const [node] = await normalize([block('divider', {})]);
    assert.equal(node.kind, 'divider');
  });

  it('quote を正規化する', async () => {
    const [node] = await normalize([block('quote', { rich_text: [text('引用文')] })]);
    assert.equal(node.kind, 'quote');
    const quote = node as Extract<ArticleBlock, { kind: 'quote' }>;
    assert.equal(plainTextOf(quote.richText), '引用文');
    assert.deepEqual(quote.children, []);
  });

  it('callout の icon と rich text を保つ', async () => {
    const [emoji] = await normalize([
      block('callout', { rich_text: [text('注記')], icon: { type: 'emoji', emoji: '💡' } }),
    ]);
    const callout = emoji as Extract<ArticleBlock, { kind: 'callout' }>;
    assert.equal(callout.kind, 'callout');
    assert.deepEqual(callout.icon, { kind: 'emoji', emoji: '💡' });
    assert.equal(plainTextOf(callout.richText), '注記');

    const [external] = await normalize([
      block('callout', { rich_text: [text('x')], icon: { type: 'external', external: { url: 'https://e/i.png' } } }),
    ]);
    assert.deepEqual((external as Extract<ArticleBlock, { kind: 'callout' }>).icon, {
      kind: 'url',
      url: 'https://e/i.png',
    });

    const [none] = await normalize([block('callout', { rich_text: [text('x')] })]);
    assert.equal((none as Extract<ArticleBlock, { kind: 'callout' }>).icon, null);
  });

  it('code の言語・本文・caption を保つ', async () => {
    const [node] = await normalize([
      block('code', {
        rich_text: [text('const x = 1;\n')],
        language: 'typescript',
        caption: [text('例')],
      }),
    ]);
    const code = node as Extract<ArticleBlock, { kind: 'code' }>;
    assert.equal(code.kind, 'code');
    assert.equal(code.code, 'const x = 1;\n');
    assert.equal(code.language, 'typescript');
    assert.equal(plainTextOf(code.caption), '例');
  });

  it('language が無い code も読める', async () => {
    const [node] = await normalize([block('code', { rich_text: [text('x')] })]);
    assert.equal((node as Extract<ArticleBlock, { kind: 'code' }>).language, null);
  });
});

describe('normalizeBlocks: image / equation / table の意味情報を捨てない', () => {
  it('image: Notion ホストの署名付き URL を external と区別して持つ', async () => {
    const [node] = await normalize([
      block('image', {
        type: 'file',
        file: { url: 'https://s3.amazonaws.com/x.svg?X-Amz-Signature=abc', expiry_time: '2026-09-06T00:00:00Z' },
        caption: [text('図1 モデル構造')],
      }),
    ]);
    const image = node as Extract<ArticleBlock, { kind: 'image' }>;
    assert.equal(image.kind, 'image');
    assert.deepEqual(image.source, {
      kind: 'notion-hosted',
      url: 'https://s3.amazonaws.com/x.svg?X-Amz-Signature=abc',
      expiryTime: '2026-09-06T00:00:00Z',
    });
    assert.equal(plainTextOf(image.caption), '図1 モデル構造');
    assert.equal(image.alt, '図1 モデル構造');
  });

  it('image: external URL は external として持つ', async () => {
    const [node] = await normalize([
      block('image', { type: 'external', external: { url: 'https://example.com/a.png' }, caption: [] }),
    ]);
    const image = node as Extract<ArticleBlock, { kind: 'image' }>;
    assert.deepEqual(image.source, { kind: 'external', url: 'https://example.com/a.png' });
    assert.equal(image.alt, null);
  });

  it('image: URL がどこにも無ければ落とす', async () => {
    await assert.rejects(
      normalize([block('image', { type: 'file', caption: [] })]),
      MalformedNotionBlockError,
    );
  });

  it('equation: expression をそのまま持つ', async () => {
    const [node] = await normalize([block('equation', { expression: 'y_{ij} = \\mu + g_i + e_j' })]);
    const equation = node as Extract<ArticleBlock, { kind: 'equation' }>;
    assert.equal(equation.kind, 'equation');
    assert.equal(equation.expression, 'y_{ij} = \\mu + g_i + e_j');
  });

  it('equation: expression が無ければ落とす', async () => {
    await assert.rejects(normalize([block('equation', {})]), MalformedNotionBlockError);
  });

  it('table: ヘッダ情報と行・セルを保つ', async () => {
    const tableId = 'table-1';
    const rows: NotionBlock[] = [
      { id: 'row-1', type: 'table_row', has_children: false, table_row: { cells: [[text('遺伝子型')], [text('収量')]] } },
      { id: 'row-2', type: 'table_row', has_children: false, table_row: { cells: [[text('A')], [text('5.2')]] } },
    ];
    const [node] = await normalize(
      [{ id: tableId, type: 'table', has_children: true, table: { table_width: 2, has_column_header: true, has_row_header: false } }],
      async (blockId) => {
        assert.equal(blockId, tableId);
        return rows;
      },
    );
    const table = node as Extract<ArticleBlock, { kind: 'table' }>;
    assert.equal(table.kind, 'table');
    assert.equal(table.hasColumnHeader, true);
    assert.equal(table.hasRowHeader, false);
    assert.equal(table.rows.length, 2);
    assert.deepEqual(table.rows[0].cells.map(plainTextOf), ['遺伝子型', '収量']);
    assert.deepEqual(table.rows[1].cells.map(plainTextOf), ['A', '5.2']);
  });

  it('table: 子が table_row でなければ落とす', async () => {
    await assert.rejects(
      normalize(
        [{ id: 't', type: 'table', has_children: true, table: {} }],
        async () => [paragraph('行のはずが段落')],
      ),
      UnsupportedNotionBlockError,
    );
  });

  it('table_row が単独で現れたら落とす', async () => {
    await assert.rejects(
      normalize([{ id: 'r', type: 'table_row', has_children: false, table_row: { cells: [] } }]),
      UnsupportedNotionBlockError,
    );
  });
});

/* --------------------------------------------------------------- list group */

describe('normalizeBlocks: リストのまとめ方', () => {
  const kinds = (nodes: ArticleBlock[]) => nodes.map((n) => n.kind);

  it('連続する箇条書きは 1 つの ul にまとまる', async () => {
    const nodes = await normalize([bullet('一'), bullet('二'), bullet('三')]);
    assert.deepEqual(kinds(nodes), ['list']);
    const list = nodes[0] as Extract<ArticleBlock, { kind: 'list' }>;
    assert.equal(list.ordered, false);
    assert.deepEqual(list.items.map((i) => plainTextOf(i.richText)), ['一', '二', '三']);
  });

  it('連続する番号付きは 1 つの ol にまとまる', async () => {
    const nodes = await normalize([numbered('一'), numbered('二')]);
    assert.deepEqual(kinds(nodes), ['list']);
    assert.equal((nodes[0] as Extract<ArticleBlock, { kind: 'list' }>).ordered, true);
  });

  it('あいだに段落が挟まればリストは分かれる', async () => {
    const nodes = await normalize([
      bullet('一'), bullet('二'),
      paragraph('あいだの文'),
      numbered('1'), numbered('2'),
    ]);
    assert.deepEqual(kinds(nodes), ['list', 'paragraph', 'list']);
    assert.equal((nodes[0] as Extract<ArticleBlock, { kind: 'list' }>).ordered, false);
    assert.equal((nodes[2] as Extract<ArticleBlock, { kind: 'list' }>).ordered, true);
  });

  it('箇条書きと番号付きが隣接していても混ざらない', async () => {
    const nodes = await normalize([bullet('a'), numbered('1'), bullet('b')]);
    assert.deepEqual(kinds(nodes), ['list', 'list', 'list']);
    assert.deepEqual(
      nodes.map((n) => (n as Extract<ArticleBlock, { kind: 'list' }>).ordered),
      [false, true, false],
    );
  });

  it('入れ子の箇条書きを子として持つ', async () => {
    const parent = bullet('親', { has_children: true });
    const nodes = await normalize([parent], async (blockId) => {
      assert.equal(blockId, parent.id);
      return [bullet('子1'), bullet('子2')];
    });
    const list = nodes[0] as Extract<ArticleBlock, { kind: 'list' }>;
    assert.equal(list.items.length, 1);
    const childList = list.items[0].children[0] as Extract<ArticleBlock, { kind: 'list' }>;
    assert.equal(childList.kind, 'list');
    assert.equal(childList.ordered, false);
    assert.deepEqual(childList.items.map((i) => plainTextOf(i.richText)), ['子1', '子2']);
  });

  it('入れ子の番号付き・種別違いの入れ子も保つ', async () => {
    const parent = bullet('親', { has_children: true });
    const nodes = await normalize([parent], async () => [numbered('1'), numbered('2')]);
    const list = nodes[0] as Extract<ArticleBlock, { kind: 'list' }>;
    const childList = list.items[0].children[0] as Extract<ArticleBlock, { kind: 'list' }>;
    assert.equal(childList.ordered, true);
  });

  it('入れ子の中で段落とリストが混ざっても順序を保つ', async () => {
    const parent = numbered('手順', { has_children: true });
    const nodes = await normalize([parent], async () => [
      paragraph('説明'), bullet('補足1'), bullet('補足2'), paragraph('締め'),
    ]);
    const list = nodes[0] as Extract<ArticleBlock, { kind: 'list' }>;
    assert.deepEqual(list.items[0].children.map((c) => c.kind), ['paragraph', 'list', 'paragraph']);
  });

  it('quote / callout の子も正規化する', async () => {
    const q = block('quote', { rich_text: [text('引用')] }, { has_children: true });
    const [node] = await normalize([q], async () => [paragraph('引用の続き')]);
    assert.deepEqual(
      (node as Extract<ArticleBlock, { kind: 'quote' }>).children.map((c) => c.kind),
      ['paragraph'],
    );
  });
});

/* -------------------------------------------------------------- child fetch */

describe('normalizeBlocks: 子の取得と再帰の安全性', () => {
  it('has_children が false なら取りに行かない', async () => {
    let called = 0;
    await normalize([bullet('単独')], async () => {
      called += 1;
      return [];
    });
    assert.equal(called, 0);
  });

  it('子の取得が失敗したら握り潰さず投げる', async () => {
    const failure = new Error('Notion API への blocks/x/children が失敗しました: 503');
    await assert.rejects(
      normalize([bullet('親', { has_children: true })], async () => {
        throw failure;
      }),
      (thrown: unknown) => thrown === failure,
    );
  });

  it('兄弟の順序を保つ', async () => {
    const nodes = await normalize([
      paragraph('1'), block('divider', {}), paragraph('2'), block('heading_2', { rich_text: [text('3')] }),
    ]);
    assert.deepEqual(nodes.map((n) => n.kind), ['paragraph', 'divider', 'paragraph', 'heading']);
  });

  it('子の取得が循環したら落とす（無限再帰にしない）', async () => {
    const self = bullet('自分', { has_children: true });
    await assert.rejects(
      normalize([self], async () => [self]),
      MalformedNotionBlockError,
    );
  });

  it('入れ子が深すぎたら落とす', async () => {
    let depth = 0;
    await assert.rejects(
      normalize([bullet('親', { has_children: true })], async () => [
        bullet(`深さ${++depth}`, { has_children: true }),
      ]),
      MalformedNotionBlockError,
    );
  });
});

/* -------------------------------------------------------------- unsupported */

describe('normalizeBlocks: 未対応を黙って消さない', () => {
  it('未知のブロック種別で落ちる', async () => {
    await assert.rejects(
      normalize([block('synced_block', {})]),
      UnsupportedNotionBlockError,
    );
  });

  it('toggle は未対応として落ちる（黙って飛ばさない）', async () => {
    await assert.rejects(normalize([block('toggle', { rich_text: [text('折りたたみ')] })]), UnsupportedNotionBlockError);
  });

  it('診断に種別・記事・ページ・ブロック ID が出る', async () => {
    await assert.rejects(
      normalizeBlocks([{ id: 'blk-9', type: 'child_page', has_children: false }], ctx()),
      (e: Error) =>
        e.message.includes('child_page') &&
        e.message.includes('test-article') &&
        e.message.includes('page-1') &&
        e.message.includes('blk-9'),
    );
  });

  it('子を置く場所が無い種別に子が付いていたら落とす', async () => {
    await assert.rejects(
      normalize([block('paragraph', { rich_text: [text('親')] }, { has_children: true })]),
      UnsupportedNotionBlockError,
    );
    await assert.rejects(
      normalize([block('heading_2', { rich_text: [text('見出し')] }, { has_children: true })]),
      UnsupportedNotionBlockError,
    );
  });

  it('ペイロードが欠けていたら落とす', async () => {
    await assert.rejects(
      normalizeBlocks([{ id: 'x', type: 'paragraph', has_children: false }], ctx()),
      MalformedNotionBlockError,
    );
  });

  it('rich_text が配列でなければ落とす', async () => {
    await assert.rejects(
      normalize([block('paragraph', { rich_text: 'ただの文字列' })]),
      MalformedNotionBlockError,
    );
  });
});

/* ---------------------------------------------------------------- rich text */

describe('normalizeBlocks: rich text', () => {
  const richTextOf = async (items: unknown[]): Promise<ArticleRichText[]> => {
    const [node] = await normalize([block('paragraph', { rich_text: items })]);
    return (node as Extract<ArticleBlock, { kind: 'paragraph' }>).richText;
  };

  it('装飾を型に写す', async () => {
    const [node] = await richTextOf([
      annotated('装飾', { bold: true, italic: true, strikethrough: true, underline: true, code: true }),
    ]);
    assert.deepEqual(node, {
      kind: 'text', text: '装飾',
      bold: true, italic: true, strikethrough: true, underline: true, code: true,
      href: null,
    });
  });

  it('装飾なしはすべて false', async () => {
    const [node] = await richTextOf([text('素の文')]);
    assert.deepEqual(node, {
      kind: 'text', text: '素の文',
      bold: false, italic: false, strikethrough: false, underline: false, code: false,
      href: null,
    });
  });

  it('annotations が無くても落ちない', async () => {
    const [node] = await richTextOf([{ type: 'text', plain_text: 'x' }]);
    assert.equal((node as Extract<ArticleRichText, { kind: 'text' }>).bold, false);
  });

  it('リンクを保つ', async () => {
    const [node] = await richTextOf([annotated('リンク', {}, 'https://example.com/a?b=c')]);
    assert.equal((node as Extract<ArticleRichText, { kind: 'text' }>).href, 'https://example.com/a?b=c');
  });

  it('相対リンクをそのまま保つ（内部リンクは相対パスで書く）', async () => {
    const [node] = await richTextOf([annotated('記事', {}, '/posts/example')]);
    assert.equal((node as Extract<ArticleRichText, { kind: 'text' }>).href, '/posts/example');
  });

  it('危険なスキームはリンクにしない（本文は残す）', async () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1) ', 'data:text/html,<script>', 'vbscript:x']) {
      const [node] = await richTextOf([annotated('危険', {}, href)]);
      const textNode = node as Extract<ArticleRichText, { kind: 'text' }>;
      assert.equal(textNode.href, null, `${href} を通した`);
      assert.equal(textNode.text, '危険'); // 文字は消さない
    }
  });

  it('インライン数式を素のテキストへ潰さない', async () => {
    const [node] = await richTextOf([
      { type: 'equation', equation: { expression: '\\sigma^2' }, plain_text: '\\sigma^2', annotations: {} },
    ]);
    assert.deepEqual(node, { kind: 'equation', expression: '\\sigma^2' });
  });

  it('mention は表示文字列を保った text 断片として扱う', async () => {
    // Notion は解決済みの表示文字列を plain_text に入れる。これを捨てると本文が欠ける
    const [node] = await richTextOf([
      { type: 'mention', mention: { type: 'date' }, plain_text: '2026-09-06', annotations: {}, href: null },
    ]);
    assert.deepEqual(node, {
      kind: 'text', text: '2026-09-06',
      bold: false, italic: false, strikethrough: false, underline: false, code: false,
      href: null,
    });
  });

  it('type が「あるのに文字列でない」断片は落とす（text に寄せない）', async () => {
    // notion-blocks.ts の semantic empty は同じ入力を「判断不能＝本文あり」に倒す。
    // こちらだけ text と決めつけると 2 つの層で結論が食い違う
    for (const brokenType of [42, null, {}, [], true]) {
      await assert.rejects(
        richTextOf([{ type: brokenType, plain_text: '' }]),
        MalformedNotionBlockError,
        `type=${JSON.stringify(brokenType)} を通した`,
      );
    }
  });

  it('type が無い断片は素のテキストとして扱う（既存フィクスチャの形）', async () => {
    const [node] = await richTextOf([{ plain_text: '本文' }]);
    assert.deepEqual(node, {
      kind: 'text',
      text: '本文',
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      href: null,
    });
  });

  it('rich_text の欠落は空として扱い、配列でない値は落とす', async () => {
    // 「無い」は空のテキスト（Notion は caption を省くことがある）。
    // 「配列でない値が入っている」のは読み取り失敗
    const [node] = await normalize([block('paragraph', {})]);
    assert.deepEqual((node as Extract<ArticleBlock, { kind: 'paragraph' }>).richText, []);
    await assert.rejects(normalize([block('paragraph', { rich_text: {} })]), MalformedNotionBlockError);
    await assert.rejects(normalize([block('paragraph', { rich_text: 0 })]), MalformedNotionBlockError);
  });

  it('未知の rich text 種別は落とす', async () => {
    await assert.rejects(
      richTextOf([{ type: 'notion_が_将来_足す_型', plain_text: 'x' }]),
      UnsupportedNotionBlockError,
    );
  });

  it('壊れた断片は落とす', async () => {
    await assert.rejects(richTextOf([null]), MalformedNotionBlockError);
    await assert.rejects(richTextOf(['文字列']), MalformedNotionBlockError);
    await assert.rejects(richTextOf([{ type: 'text' }]), MalformedNotionBlockError);
    await assert.rejects(richTextOf([{ type: 'text', plain_text: 42 }]), MalformedNotionBlockError);
  });

  it('HTML に見える文字列も文字として保つ（エスケープは描画側の責務）', async () => {
    const [node] = await richTextOf([text('<script>alert(1)</script> & "x"')]);
    assert.equal(
      (node as Extract<ArticleRichText, { kind: 'text' }>).text,
      '<script>alert(1)</script> & "x"',
    );
  });
});

describe('buildArticleDocument', () => {
  it('ブロックの並びを document にする', async () => {
    const doc = await buildArticleDocument([paragraph('本文'), block('divider', {})], ctx());
    assert.deepEqual(doc.blocks.map((b) => b.kind), ['paragraph', 'divider']);
  });

  it('空のページ本文は空の document になる', async () => {
    assert.deepEqual(await buildArticleDocument([], ctx()), { blocks: [] });
  });
});
