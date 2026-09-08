import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitArticleTableRows, tableCellHeaderScope } from './article-table.ts';
import type { ArticleTableBlock } from './article-table.ts';

const rows: ArticleTableBlock['rows'] = [
  { id: 'r1', cells: [[], []] },
  { id: 'r2', cells: [[], []] },
  { id: 'r3', cells: [[], []] },
];

describe('splitArticleTableRows: header row を semantic section に分ける', () => {
  it('column header があれば先頭行だけを thead 相当へ分ける', () => {
    const result = splitArticleTableRows({
      kind: 'table', id: 't', hasColumnHeader: true, hasRowHeader: false, rows,
    });
    assert.equal(result.headerRow?.id, 'r1');
    assert.deepEqual(result.bodyRows.map((row) => row.id), ['r2', 'r3']);
  });

  it('column header が無ければ全行を tbody 相当に置く', () => {
    const result = splitArticleTableRows({
      kind: 'table', id: 't', hasColumnHeader: false, hasRowHeader: false, rows,
    });
    assert.equal(result.headerRow, null);
    assert.deepEqual(result.bodyRows.map((row) => row.id), ['r1', 'r2', 'r3']);
  });

  it('空表で column header が指定されても架空の行を作らない', () => {
    const result = splitArticleTableRows({
      kind: 'table', id: 't', hasColumnHeader: true, hasRowHeader: false, rows: [],
    });
    assert.equal(result.headerRow, null);
    assert.deepEqual(result.bodyRows, []);
  });

  it('入力の rows 配列を変更しない', () => {
    const original = [...rows];
    splitArticleTableRows({
      kind: 'table', id: 't', hasColumnHeader: true, hasRowHeader: false, rows,
    });
    assert.deepEqual(rows, original);
  });
});

describe('tableCellHeaderScope: th / td の意味を決める', () => {
  it('列ヘッダ行は全セル scope=col', () => {
    assert.equal(tableCellHeaderScope({ columnHeader: true, rowHeader: false }, 0), 'col');
    assert.equal(tableCellHeaderScope({ columnHeader: true, rowHeader: false }, 3), 'col');
  });

  it('列・行ヘッダが重なる先頭セルは scope=col を優先する', () => {
    assert.equal(tableCellHeaderScope({ columnHeader: true, rowHeader: true }, 0), 'col');
  });

  it('本文行の先頭セルだけを scope=row にする', () => {
    assert.equal(tableCellHeaderScope({ columnHeader: false, rowHeader: true }, 0), 'row');
    assert.equal(tableCellHeaderScope({ columnHeader: false, rowHeader: true }, 1), null);
  });

  it('ヘッダ指定が無ければ通常セルにする', () => {
    assert.equal(tableCellHeaderScope({ columnHeader: false, rowHeader: false }, 0), null);
  });
});
