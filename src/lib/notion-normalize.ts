import { safeHref } from './content-links.ts';
import type {
  ArticleBlock,
  ArticleDocument,
  ArticleIcon,
  ArticleImageSource,
  ArticleListItem,
  ArticleRichText,
  ArticleTableRow,
} from './article-document.ts';
import type { NotionBlock } from './notion-blocks.ts';

/**
 * Notion の生ブロック → ArticleDocument。
 *
 * **この層だけが Notion の API 形状を知っている。** 描画側は ArticleDocument しか
 * 読まないので、Notion の API バージョンを上げても（Issue #14）影響がここで止まる。
 *
 * 方針は 3 つ。
 *
 * 1. **知らないものは落とす（fail closed）。** 未対応のブロックや rich text を
 *    `null` で読み飛ばすと、本文の一部が欠けた記事が「正常なビルド」として公開される。
 * 2. **意味を潰さない。** インライン数式を `$x^2$` のような文字列にしない。画像の
 *    署名付き URL と外部 URL を区別して持つ。table のヘッダ情報を捨てない。
 * 3. **連続する list item をここで束ねる。** Notion は箇条書きを 1 行ずつ返すので、
 *    描画側で素直に回すと `<ul>` が項目の数だけできる。
 */

/** 子ブロックを取りに行く関数。#4 の fetchAllBlockChildren をそのまま渡せる形 */
export type ChildBlockFetcher = (blockId: string) => Promise<NotionBlock[]>;

export type NormalizeContext = {
  /** 診断用。どの記事で落ちたのかを出す */
  slug: string;
  pageId: string;
  fetchChildren: ChildBlockFetcher;
};

/**
 * 入れ子の深さの上限。
 *
 * Notion の UI 上ここまで深い記事は書けない。これを超えるのは応答か実装が
 * 壊れている場合なので、再帰を続けずに落とす。
 */
const MAX_DEPTH = 12;

export class UnsupportedNotionBlockError extends Error {
  constructor(info: { type: string; blockId: string; slug: string; pageId: string; hint?: string }) {
    super(
      `Notion のブロック種別 "${info.type}" は記事本文として未対応です。\n` +
        `  記事: ${info.slug}\n` +
        `  Notion ページ: ${info.pageId}\n` +
        `  ブロック: ${info.blockId}\n` +
        (info.hint ? `  ${info.hint}\n` : '') +
        '未対応のブロックを黙って飛ばすと、本文の一部が欠けた記事がそのまま公開されます。\n' +
        'src/lib/notion-normalize.ts で対応するか、Notion 側で別の書き方に変えてください。',
    );
    this.name = 'UnsupportedNotionBlockError';
  }
}

export class MalformedNotionBlockError extends Error {
  constructor(info: { type: string; blockId: string; slug: string; detail: string }) {
    super(
      `Notion のブロック "${info.type}" の中身を読み取れませんでした。\n` +
        `  記事: ${info.slug}\n` +
        `  ブロック: ${info.blockId}\n` +
        `  ${info.detail}\n` +
        '推測で補わずに落とします。誤った本文を公開するより安全なためです。',
    );
    this.name = 'MalformedNotionBlockError';
  }
}

/* ------------------------------------------------------------------ rich text */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const flag = (annotations: Record<string, unknown> | null, key: string): boolean =>
  annotations?.[key] === true;

/**
 * rich text 断片 1 件を正規化する。
 *
 * `mention`（ページ・人・日付への参照）は **text 断片として扱う**。Notion が
 * 解決済みの表示文字列を plain_text に入れてくれるので、それをそのまま本文にする。
 * リンク先が付いていれば残すが、Notion のページ参照は `app.notion.com` の絶対 URL に
 * なることがあり、それは D-13 が禁じている形である。**その検出は Issue #6 の担当**で、
 * ここでは先取りしない（半端に弾くと #6 の検査が「もう半分やってある」状態になる）。
 */
function normalizeRichTextItem(
  item: unknown,
  ctx: { slug: string; blockId: string; blockType: string },
): ArticleRichText {
  const record = asRecord(item);
  if (!record) {
    throw new MalformedNotionBlockError({
      ...ctx,
      type: ctx.blockType,
      detail: `rich_text の要素がオブジェクトではありません（${typeof item}）`,
    });
  }

  // type が「あるのに文字列でない」のは読み取り失敗であって text ではない。
  // 推測で text に寄せると、壊れた応答が空の段落として静かに公開される。
  // notion-blocks.ts の semantic empty 判定も同じ入力を「判断不能＝本文あり」に
  // 倒しており、こちらだけ text と決めつけると 2 つの層で結論が食い違う。
  if (record.type !== undefined && typeof record.type !== 'string') {
    throw new MalformedNotionBlockError({
      ...ctx,
      type: ctx.blockType,
      detail: `rich_text の要素の type が文字列ではありません（${typeof record.type}）`,
    });
  }

  // type が無い断片は text として扱う。Notion は必ず type を返すが、
  // 簡略なフィクスチャや将来の省略に備えて、欠落は「素のテキスト」に倒す
  const type = asString(record.type) ?? 'text';
  const plainText = asString(record.plain_text);

  if (type === 'equation') {
    const expression = asString(asRecord(record.equation)?.expression) ?? plainText;
    if (expression === null) {
      throw new MalformedNotionBlockError({
        ...ctx,
        type: ctx.blockType,
        detail: 'インライン数式に expression がありません',
      });
    }
    // 素のテキストへ潰さない。後段の KaTeX SSR が型を見て描画する
    return { kind: 'equation', expression };
  }

  if (type !== 'text' && type !== 'mention') {
    throw new UnsupportedNotionBlockError({
      type: `rich_text:${type}`,
      blockId: ctx.blockId,
      slug: ctx.slug,
      pageId: '(rich text)',
      hint: 'text / mention / equation のみ対応しています',
    });
  }

  if (plainText === null) {
    throw new MalformedNotionBlockError({
      ...ctx,
      type: ctx.blockType,
      detail: 'rich_text の要素に plain_text がありません',
    });
  }

  const annotations = asRecord(record.annotations);
  return {
    kind: 'text',
    text: plainText,
    bold: flag(annotations, 'bold'),
    italic: flag(annotations, 'italic'),
    strikethrough: flag(annotations, 'strikethrough'),
    underline: flag(annotations, 'underline'),
    code: flag(annotations, 'code'),
    // 危険なスキームはここで落とす。規則の本体は content-links.ts（D-19）
    href: safeHref(asString(record.href)),
  };
}

/**
 * rich text の配列を正規化する。
 *
 * **「無い」と「壊れている」を分ける。** 項目そのものが無い（undefined / null）のは
 * 空のテキストであって異常ではない。Notion は caption を省くことがあり、
 * 空の段落・空の見出しも正常な本文である。一方 **配列でない値が入っている**のは
 * 読み取り失敗なので落とす。
 */
function normalizeRichText(
  value: unknown,
  ctx: { slug: string; blockId: string; blockType: string },
): ArticleRichText[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new MalformedNotionBlockError({
      ...ctx,
      type: ctx.blockType,
      detail: 'rich_text が配列ではありません',
    });
  }
  return value.map((item) => normalizeRichTextItem(item, ctx));
}

/* ---------------------------------------------------------------------- blocks */

/** rich text だけを持つブロック（段落・見出し・引用・リスト項目など）の共通取り出し */
function payloadOf(block: NotionBlock, slug: string): Record<string, unknown> {
  const payload = asRecord(block[block.type]);
  if (!payload) {
    throw new MalformedNotionBlockError({
      type: block.type,
      blockId: block.id,
      slug,
      detail: `${block.type} のペイロードがありません`,
    });
  }
  return payload;
}

const HEADING_LEVELS: Record<string, 1 | 2 | 3> = {
  heading_1: 1,
  heading_2: 2,
  heading_3: 3,
};

/** 子を置く場所がある種別。これ以外で has_children が来たら落とす */
const BLOCKS_WITH_CHILDREN = new Set([
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'callout',
  'table',
]);

function normalizeIcon(value: unknown): ArticleIcon | null {
  const icon = asRecord(value);
  if (!icon) return null;

  const emoji = asString(icon.emoji);
  if (emoji) return { kind: 'emoji', emoji };

  const url = asString(asRecord(icon.external)?.url) ?? asString(asRecord(icon.file)?.url);
  return url ? { kind: 'url', url } : null;
}

function normalizeImageSource(
  payload: Record<string, unknown>,
  block: NotionBlock,
  slug: string,
): ArticleImageSource {
  const external = asString(asRecord(payload.external)?.url);
  if (external) return { kind: 'external', url: external };

  const file = asRecord(payload.file);
  const fileUrl = asString(file?.url);
  if (fileUrl) {
    // Notion がホストする署名付き URL。有効期限があるのでそのまま HTML へ出せない
    return { kind: 'notion-hosted', url: fileUrl, expiryTime: asString(file?.expiry_time) };
  }

  throw new MalformedNotionBlockError({
    type: block.type,
    blockId: block.id,
    slug,
    detail: '画像に file.url も external.url もありません',
  });
}

/* ------------------------------------------------------------------ normalize */

/**
 * ブロックの並びを ArticleBlock の並びへ変換する。
 *
 * 連続する list item をここで束ねる。`has_children` を持つブロックは
 * fetchChildren で子を取りに行き、同じ関数で再帰的に正規化する。
 */
export async function normalizeBlocks(
  blocks: readonly NotionBlock[],
  ctx: NormalizeContext,
  depth = 0,
  ancestors: readonly string[] = [],
): Promise<ArticleBlock[]> {
  if (depth > MAX_DEPTH) {
    throw new MalformedNotionBlockError({
      type: '(nesting)',
      blockId: ancestors[ancestors.length - 1] ?? '(root)',
      slug: ctx.slug,
      detail: `入れ子が ${MAX_DEPTH} 段を超えました`,
    });
  }

  const out: ArticleBlock[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    const listType = LIST_TYPES[block.type];

    if (listType) {
      // 同じ種別が続くあいだをひとつのリストにまとめる
      const items: ArticleListItem[] = [];
      while (index < blocks.length && blocks[index].type === block.type) {
        items.push(await normalizeListItem(blocks[index], ctx, depth, ancestors));
        index += 1;
      }
      out.push({ kind: 'list', ordered: listType === 'ordered', items });
      continue;
    }

    out.push(await normalizeBlock(block, ctx, depth, ancestors));
    index += 1;
  }

  return out;
}

const LIST_TYPES: Record<string, 'ordered' | 'unordered' | undefined> = {
  bulleted_list_item: 'unordered',
  numbered_list_item: 'ordered',
};

async function fetchChildBlocks(
  block: NotionBlock,
  ctx: NormalizeContext,
  depth: number,
  ancestors: readonly string[],
): Promise<ArticleBlock[]> {
  if (block.has_children !== true) return [];

  // 同じブロックが自分の祖先に現れたら循環。Notion は通常返さないが、
  // 返ってきた場合に無限再帰でビルドを固めない
  if (ancestors.includes(block.id)) {
    throw new MalformedNotionBlockError({
      type: block.type,
      blockId: block.id,
      slug: ctx.slug,
      detail: '子ブロックの取得が循環しています',
    });
  }

  // 取得の失敗は握り潰さない（#4 と同じ方針）。部分的な本文を本文として扱わない
  const children = await ctx.fetchChildren(block.id);
  return normalizeBlocks(children, ctx, depth + 1, [...ancestors, block.id]);
}

async function normalizeListItem(
  block: NotionBlock,
  ctx: NormalizeContext,
  depth: number,
  ancestors: readonly string[],
): Promise<ArticleListItem> {
  const payload = payloadOf(block, ctx.slug);
  return {
    id: block.id,
    richText: normalizeRichText(payload.rich_text, {
      slug: ctx.slug,
      blockId: block.id,
      blockType: block.type,
    }),
    children: await fetchChildBlocks(block, ctx, depth, ancestors),
  };
}

async function normalizeTable(block: NotionBlock, ctx: NormalizeContext): Promise<ArticleBlock> {
  const payload = payloadOf(block, ctx.slug);
  // table の行は必ず子ブロック（table_row）として返る
  const rowBlocks = block.has_children === true ? await ctx.fetchChildren(block.id) : [];

  const rows: ArticleTableRow[] = rowBlocks.map((row) => {
    if (row.type !== 'table_row') {
      throw new UnsupportedNotionBlockError({
        type: row.type,
        blockId: row.id,
        slug: ctx.slug,
        pageId: ctx.pageId,
        hint: 'table の子は table_row だけのはずです',
      });
    }
    const cells = payloadOf(row, ctx.slug).cells;
    if (!Array.isArray(cells)) {
      throw new MalformedNotionBlockError({
        type: row.type,
        blockId: row.id,
        slug: ctx.slug,
        detail: 'table_row に cells がありません',
      });
    }
    return {
      id: row.id,
      cells: cells.map((cell) =>
        normalizeRichText(cell, { slug: ctx.slug, blockId: row.id, blockType: row.type }),
      ),
    };
  });

  return {
    kind: 'table',
    id: block.id,
    hasColumnHeader: payload.has_column_header === true,
    hasRowHeader: payload.has_row_header === true,
    rows,
  };
}

async function normalizeBlock(
  block: NotionBlock,
  ctx: NormalizeContext,
  depth: number,
  ancestors: readonly string[],
): Promise<ArticleBlock> {
  const richTextCtx = { slug: ctx.slug, blockId: block.id, blockType: block.type };

  // 子を置く場所が無い種別に子が付いていたら、黙って捨てずに落とす
  if (block.has_children === true && !BLOCKS_WITH_CHILDREN.has(block.type)) {
    throw new UnsupportedNotionBlockError({
      type: block.type,
      blockId: block.id,
      slug: ctx.slug,
      pageId: ctx.pageId,
      hint: `${block.type} に子ブロックが付いていますが、この種別の子は未対応です（子の内容が失われます）`,
    });
  }

  switch (block.type) {
    case 'paragraph':
      return {
        kind: 'paragraph',
        id: block.id,
        richText: normalizeRichText(payloadOf(block, ctx.slug).rich_text, richTextCtx),
      };

    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return {
        kind: 'heading',
        id: block.id,
        level: HEADING_LEVELS[block.type],
        richText: normalizeRichText(payloadOf(block, ctx.slug).rich_text, richTextCtx),
      };

    case 'quote': {
      const payload = payloadOf(block, ctx.slug);
      return {
        kind: 'quote',
        id: block.id,
        richText: normalizeRichText(payload.rich_text, richTextCtx),
        children: await fetchChildBlocks(block, ctx, depth, ancestors),
      };
    }

    case 'callout': {
      const payload = payloadOf(block, ctx.slug);
      return {
        kind: 'callout',
        id: block.id,
        richText: normalizeRichText(payload.rich_text, richTextCtx),
        icon: normalizeIcon(payload.icon),
        children: await fetchChildBlocks(block, ctx, depth, ancestors),
      };
    }

    case 'divider':
      return { kind: 'divider', id: block.id };

    case 'code': {
      const payload = payloadOf(block, ctx.slug);
      const codeText = normalizeRichText(payload.rich_text, richTextCtx)
        .map((node) => (node.kind === 'text' ? node.text : node.expression))
        .join('');
      return {
        kind: 'code',
        id: block.id,
        code: codeText,
        language: asString(payload.language),
        caption: normalizeRichText(payload.caption, richTextCtx),
      };
    }

    case 'image': {
      const payload = payloadOf(block, ctx.slug);
      const caption = normalizeRichText(payload.caption, richTextCtx);
      return {
        kind: 'image',
        id: block.id,
        source: normalizeImageSource(payload, block, ctx.slug),
        caption,
        // Notion に alt 専用の項目は無い。caption を代替テキストの種として持たせる
        alt: caption.length > 0 ? plainTextOf(caption) : null,
      };
    }

    case 'equation': {
      const payload = payloadOf(block, ctx.slug);
      const expression = asString(payload.expression);
      if (expression === null) {
        throw new MalformedNotionBlockError({
          type: block.type,
          blockId: block.id,
          slug: ctx.slug,
          detail: 'equation に expression がありません',
        });
      }
      return { kind: 'equation', id: block.id, expression };
    }

    case 'table':
      return normalizeTable(block, ctx);

    case 'table_row':
      throw new UnsupportedNotionBlockError({
        type: block.type,
        blockId: block.id,
        slug: ctx.slug,
        pageId: ctx.pageId,
        hint: 'table_row は table の子としてのみ現れるはずです',
      });

    default:
      throw new UnsupportedNotionBlockError({
        type: block.type,
        blockId: block.id,
        slug: ctx.slug,
        pageId: ctx.pageId,
        hint: 'toggle / synced_block / child_page などは未対応です',
      });
  }
}

/** rich text の見える文字列だけを取り出す（alt の生成などに使う） */
export function plainTextOf(nodes: readonly ArticleRichText[]): string {
  return nodes.map((node) => (node.kind === 'text' ? node.text : node.expression)).join('');
}

/** Notion のページ本文を ArticleDocument にする */
export async function buildArticleDocument(
  blocks: readonly NotionBlock[],
  ctx: NormalizeContext,
): Promise<ArticleDocument> {
  return { blocks: await normalizeBlocks(blocks, ctx) };
}
