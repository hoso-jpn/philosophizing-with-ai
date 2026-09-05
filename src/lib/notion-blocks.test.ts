import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NotionPageBodyError,
  fetchAllBlockChildren,
  isBlockSemanticallyEmpty,
  isPageBodySemanticallyEmpty,
  parseBlockChildrenPage,
  type NotionBlock,
} from './notion-blocks.ts';

const paragraph = (text: string, id = 'b1'): NotionBlock => ({
  id,
  type: 'paragraph',
  has_children: false,
  paragraph: { rich_text: text ? [{ plain_text: text }] : [] },
});

const divider = (id = 'd1'): NotionBlock => ({ id, type: 'divider', has_children: false, divider: {} });

/** results 1 ページ分の応答を組み立てる */
const responsePage = (results: NotionBlock[], nextCursor: string | null = null) => ({
  object: 'list',
  results,
  has_more: nextCursor !== null,
  next_cursor: nextCursor,
});

describe('parseBlockChildrenPage: 応答の検証', () => {
  it('type 固有のペイロードを削らずに残す（#5 の renderer が読む）', () => {
    const page = parseBlockChildrenPage('p1', responsePage([paragraph('本文')]));
    assert.deepEqual(page.blocks[0].paragraph, { rich_text: [{ plain_text: '本文' }] });
    assert.equal(page.nextCursor, null);
  });

  it('has_more と next_cursor から次ページの有無を決める', () => {
    assert.equal(parseBlockChildrenPage('p1', responsePage([], 'cur-2')).nextCursor, 'cur-2');
    assert.equal(parseBlockChildrenPage('p1', responsePage([])).nextCursor, null);
  });

  it('results が無い・配列でない応答は例外（空本文として扱わない）', () => {
    assert.throws(() => parseBlockChildrenPage('p1', { object: 'list' }), NotionPageBodyError);
    assert.throws(() => parseBlockChildrenPage('p1', { results: 'x' }), NotionPageBodyError);
    assert.throws(() => parseBlockChildrenPage('p1', null), NotionPageBodyError);
    assert.throws(() => parseBlockChildrenPage('p1', 'not json'), NotionPageBodyError);
  });

  it('block に id / type が無ければ例外', () => {
    assert.throws(
      () => parseBlockChildrenPage('p1', responsePage([{ type: 'paragraph' } as unknown as NotionBlock])),
      NotionPageBodyError,
    );
  });

  it('has_more が true なのに next_cursor が無ければ例外（黙って打ち切らない）', () => {
    assert.throws(
      () => parseBlockChildrenPage('p1', { results: [], has_more: true, next_cursor: null }),
      NotionPageBodyError,
    );
  });
});

describe('fetchAllBlockChildren: ページネーション', () => {
  it('2 ページ以上に分かれていても全件取得する', async () => {
    const pages = [
      responsePage([paragraph('1 ページ目', 'a')], 'cur-2'),
      responsePage([paragraph('2 ページ目', 'b')], 'cur-3'),
      responsePage([paragraph('3 ページ目', 'c')]),
    ];
    const cursors: (string | null)[] = [];
    let called = 0;

    const blocks = await fetchAllBlockChildren('page-1', async (blockId, cursor) => {
      assert.equal(blockId, 'page-1');
      cursors.push(cursor);
      return pages[called++];
    });

    assert.equal(called, 3);
    assert.deepEqual(cursors, [null, 'cur-2', 'cur-3']);
    assert.deepEqual(blocks.map((b) => b.id), ['a', 'b', 'c']);
  });

  it('途中のページで失敗したら、それまでの分を返さずに投げる', async () => {
    let called = 0;
    await assert.rejects(
      fetchAllBlockChildren('page-1', async () => {
        if (called++ === 0) return responsePage([paragraph('前半', 'a')], 'cur-2');
        throw new Error('Notion API への blocks/page-1/children が失敗しました: 500');
      }),
      /500/,
    );
    assert.equal(called, 2);
  });

  it('途中のページの応答が壊れていたら投げる', async () => {
    let called = 0;
    await assert.rejects(
      fetchAllBlockChildren('page-1', async () =>
        called++ === 0 ? responsePage([paragraph('前半', 'a')], 'cur-2') : { results: null },
      ),
      NotionPageBodyError,
    );
  });

  it('同じ next_cursor が返り続けても無限ループにしない', async () => {
    await assert.rejects(
      fetchAllBlockChildren('page-1', async () => responsePage([paragraph('x')], 'same')),
      NotionPageBodyError,
    );
  });
});

describe('isPageBodySemanticallyEmpty: 空の定義', () => {
  it('ブロック 0 件は空', () => {
    assert.equal(isPageBodySemanticallyEmpty([]), true);
  });

  it('空 paragraph だけなら空', () => {
    assert.equal(isPageBodySemanticallyEmpty([paragraph('')]), true);
    assert.equal(isPageBodySemanticallyEmpty([paragraph(''), paragraph('', 'b2')]), true);
  });

  it('空白だけの paragraph も空（全角空白・改行・タブを含む）', () => {
    assert.equal(isPageBodySemanticallyEmpty([paragraph('   ')]), true);
    assert.equal(isPageBodySemanticallyEmpty([paragraph('　')]), true);
    assert.equal(isPageBodySemanticallyEmpty([paragraph('\n\t ')]), true);
  });

  it('文字があれば空ではない', () => {
    assert.equal(isPageBodySemanticallyEmpty([paragraph('本文')]), false);
    assert.equal(isPageBodySemanticallyEmpty([paragraph(''), paragraph('本文', 'b2')]), false);
  });

  it('divider / image / equation / table はテキストが無くても本文として扱う', () => {
    assert.equal(isPageBodySemanticallyEmpty([divider()]), false);
    for (const type of ['image', 'equation', 'table', 'code', 'embed', 'child_database']) {
      const block: NotionBlock = { id: 'x', type, has_children: false, [type]: {} };
      assert.equal(isPageBodySemanticallyEmpty([block]), false, `${type} を空と判定した`);
    }
  });

  it('空 paragraph に divider が 1 本混ざれば本文あり', () => {
    assert.equal(isPageBodySemanticallyEmpty([paragraph(''), divider()]), false);
  });

  it('未知のブロック種別は本文ありに倒す（黙って legacy へ戻さない）', () => {
    const block: NotionBlock = { id: 'x', type: 'notion_が_将来_増やす_型', has_children: false };
    assert.equal(isPageBodySemanticallyEmpty([block]), false);
  });

  it('子を持つ paragraph は、その行が空でも本文あり', () => {
    const block: NotionBlock = { ...paragraph(''), has_children: true };
    assert.equal(isBlockSemanticallyEmpty(block), false);
  });

  it('mention / equation は plain_text が空でも本文として扱う', () => {
    // Notion の rich_text は text / mention / equation の 3 種。後ろ 2 つは
    // plain_text 以外に意味を持つので、テキストが空でも空と判定してはいけない
    const fragment = (item: unknown): NotionBlock => ({
      id: 'x',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: [item] },
    });

    assert.equal(
      isPageBodySemanticallyEmpty([fragment({ type: 'mention', plain_text: '@ページ' })]),
      false,
    );
    assert.equal(
      isPageBodySemanticallyEmpty([
        fragment({ type: 'equation', plain_text: 'x^2', equation: { expression: 'x^2' } }),
      ]),
      false,
    );
    // plain_text が空でも type で本文ありと判定できる
    assert.equal(isPageBodySemanticallyEmpty([fragment({ type: 'mention', plain_text: '' })]), false);
    assert.equal(
      isPageBodySemanticallyEmpty([
        fragment({ type: 'equation', plain_text: '   ', equation: { expression: '\\\\' } }),
      ]),
      false,
    );
  });

  it('type: text の空・空白は従来どおり空', () => {
    const textFragment = (text: string): NotionBlock => ({
      id: 'x',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: [{ type: 'text', plain_text: text, text: { content: text } }] },
    });

    assert.equal(isPageBodySemanticallyEmpty([textFragment('')]), true);
    assert.equal(isPageBodySemanticallyEmpty([textFragment('   ')]), true);
    assert.equal(isPageBodySemanticallyEmpty([textFragment('　\n\t')]), true);
    assert.equal(isPageBodySemanticallyEmpty([textFragment('本文')]), false);
  });

  it('rich_text 断片がオブジェクトでなければ本文ありに倒す', () => {
    const block: NotionBlock = {
      id: 'x',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: ['文字列', null, 42] },
    };
    assert.equal(isPageBodySemanticallyEmpty([block]), false);
  });

  it('paragraph なのに rich_text が読めなければ本文ありに倒す', () => {
    assert.equal(isBlockSemanticallyEmpty({ id: 'x', type: 'paragraph' }), false);
    assert.equal(
      isBlockSemanticallyEmpty({ id: 'x', type: 'paragraph', paragraph: { rich_text: 'x' } }),
      false,
    );
    assert.equal(
      isBlockSemanticallyEmpty({ id: 'x', type: 'paragraph', paragraph: { rich_text: [{}] } }),
      false,
    );
  });
});
