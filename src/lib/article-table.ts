import type { ArticleBlock, ArticleTableRow } from './article-document.ts';

export type ArticleTableBlock = Extract<ArticleBlock, { kind: 'table' }>;
export type TableHeaderScope = 'col' | 'row' | null;

/** Notion の has_column_header を thead / tbody の境界へ変換する。 */
export function splitArticleTableRows(block: ArticleTableBlock): {
  headerRow: ArticleTableRow | null;
  bodyRows: ArticleTableRow[];
} {
  if (!block.hasColumnHeader || block.rows.length === 0) {
    return { headerRow: null, bodyRows: [...block.rows] };
  }
  return { headerRow: block.rows[0], bodyRows: block.rows.slice(1) };
}

/** 1セルを th にする場合の scope。列ヘッダ行を行ヘッダより優先する。 */
export function tableCellHeaderScope(
  options: { columnHeader: boolean; rowHeader: boolean },
  cellIndex: number,
): TableHeaderScope {
  if (options.columnHeader) return 'col';
  if (options.rowHeader && cellIndex === 0) return 'row';
  return null;
}
