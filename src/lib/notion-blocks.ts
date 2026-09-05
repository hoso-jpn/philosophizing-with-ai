import { z } from 'zod';

/**
 * Notion のページ本文（block children）を扱う層。
 *
 * ここは **取得と判定だけ**を持つ。HTML への描画は Issue #5 の typed renderer が担う。
 * その前段として、
 *
 * 1. block children API のページネーションを最後まで辿ること
 * 2. 「取得は正常に終わったが本文が空だった」ことを、取得の失敗と区別して判定できること
 *
 * の 2 点だけをここで確定させる。
 *
 * ネットワークは持たない。1 リクエスト分の取得は呼び出し側から関数で渡す。
 * こうしておくと、ページネーションの分岐も semantic empty の判定も、
 * 実際の Notion API に触れずに unit test で固定できる。
 */

/** Notion の rich_text 断片。type 固有のペイロードは触らずそのまま持つ */
export type NotionRichText = { plain_text: string; [key: string]: unknown };

/**
 * Notion の block。
 *
 * type 固有のペイロード（`paragraph`, `image`, `table` …）は捨てずにそのまま残す。
 * Issue #5 の renderer が読むのはそこなので、この層で削ぎ落としてはいけない。
 */
export type NotionBlock = {
  id: string;
  type: string;
  /** 子ブロックを持つか。#5 で再帰取得するときの入口 */
  has_children?: boolean;
  [key: string]: unknown;
};

/**
 * ページ本文の取得に失敗したことを表す例外。
 *
 * **「本文が空だった」とは決して混同しない。** これが投げられたらビルドを止める。
 * 空との取り違えは、移行済み記事が黙って古い legacy Content へ戻る事故になる。
 */
export class NotionPageBodyError extends Error {
  constructor(blockId: string, detail: string) {
    super(
      `Notion のページ本文 ${blockId} を取得できませんでした。\n${detail}\n` +
        `これは「本文が空」ではなく取得の失敗です。legacy Content へフォールバックせず、\n` +
        `ビルドを止めます（直前の正常なデプロイがそのまま稼働し続けます）。`,
    );
    this.name = 'NotionPageBodyError';
  }
}

/** 未知のキーを落とさない。type 固有のペイロードを renderer へ渡すため */
const notionBlockSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  has_children: z.boolean().optional(),
});

const blockChildrenSchema = z.looseObject({
  results: z.array(notionBlockSchema),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
});

/** 1 リクエスト分の応答 */
export type BlockChildrenPage = {
  blocks: NotionBlock[];
  /** 次のページがあればカーソル、無ければ null */
  nextCursor: string | null;
};

/**
 * block children API の応答 1 ページ分を検証する。
 *
 * `has_more: true` なのに `next_cursor` が無い応答は**打ち切らずに落とす**。
 * そこで静かに打ち切ると、本文の後半が欠けた記事がそのまま公開される。
 */
export function parseBlockChildrenPage(blockId: string, payload: unknown): BlockChildrenPage {
  const parsed = blockChildrenSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new NotionPageBodyError(blockId, `応答の形が想定と違います。\n${detail}`);
  }

  const { results, has_more, next_cursor } = parsed.data;
  if (has_more === true && (next_cursor === null || next_cursor === undefined || next_cursor === '')) {
    throw new NotionPageBodyError(
      blockId,
      '  - has_more が true なのに next_cursor がありません（続きを取得できません）',
    );
  }

  return {
    blocks: results as NotionBlock[],
    nextCursor: has_more === true ? (next_cursor as string) : null,
  };
}

/** 1 リクエスト分の取得。cursor が null なら先頭ページ */
export type BlockChildrenFetcher = (blockId: string, cursor: string | null) => Promise<unknown>;

/**
 * 上限。100 件/ページなので 20,000 ブロック相当。
 * これを超えるのは応答が壊れて同じページを回り続けている場合とみなす。
 */
const MAX_PAGES = 200;

/**
 * ページネーションを辿って、あるブロックの子を全件取得する。
 *
 * 引数が pageId ではなく blockId なのは意図的で、Notion では「ページ本文の取得」も
 * 「ブロックの子の取得」も同じ `blocks/<id>/children` である。Issue #5 で
 * `has_children` を持つブロックを再帰的に辿るときも、この関数をそのまま使える。
 *
 * 途中のページで失敗したら、それまでに集めた分を返さずに例外を投げる。
 * 部分的な本文を「取得できた本文」として扱わないため。
 */
export async function fetchAllBlockChildren(
  blockId: string,
  fetchPage: BlockChildrenFetcher,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;

  do {
    const page = parseBlockChildrenPage(blockId, await fetchPage(blockId, cursor));
    blocks.push(...page.blocks);
    cursor = page.nextCursor;

    if (cursor !== null) {
      // 同じカーソルが返ってきたら進んでいない。無限ループにする前に落とす
      if (seenCursors.has(cursor)) {
        throw new NotionPageBodyError(blockId, `  - next_cursor が繰り返されました（${cursor}）`);
      }
      seenCursors.add(cursor);
    }

    if (++pages > MAX_PAGES) {
      throw new NotionPageBodyError(blockId, `  - ページネーションが ${MAX_PAGES} ページを超えました`);
    }
  } while (cursor !== null);

  return blocks;
}

/**
 * 「中身が rich_text だけ」のブロック種別。
 *
 * ここに挙げた種別だけが「テキストが空なら空」と判定される。**意図的に paragraph
 * だけに絞ってある。** divider / image / equation / table / code などはテキストを
 * 持たないか、テキスト以外に意味があるため、text content で空と判定してはいけない。
 *
 * 未知の種別も同じ理由で「本文あり」に倒す。Notion がブロック種別を増やしたとき、
 * 新種別だけで書かれた記事が「空」と判定されて legacy Content へ黙って戻るより、
 * 「本文あり」と判定されて #5 の renderer が未対応を報告する方が安全である。
 */
const TEXT_ONLY_BLOCK_TYPES = new Set(['paragraph']);

/**
 * ブロック 1 件が意味的に空か。
 *
 * 判断できない場合は必ず false（＝本文あり）に倒す。fallback は legacy Content へ
 * 戻る方向なので、迷ったら「空ではない」と言う方が安全側になる。
 */
export function isBlockSemanticallyEmpty(block: NotionBlock): boolean {
  // 子を持つなら、この行自体が空でも中に本文がある
  if (block.has_children === true) return false;
  if (!TEXT_ONLY_BLOCK_TYPES.has(block.type)) return false;

  const payload = block[block.type];
  const richText = (payload as { rich_text?: unknown } | undefined)?.rich_text;
  // paragraph なのに rich_text が読めない＝想定外。空とは言い切れない
  if (!Array.isArray(richText)) return false;

  return richText.every((item) => {
    const text = (item as { plain_text?: unknown } | null)?.plain_text;
    return typeof text === 'string' && text.trim() === '';
  });
}

/**
 * ページ本文が意味的に空か。
 *
 * 「ブロックが 1 件以上ある」を本文ありの条件にしない。Notion のページは編集の
 * 副産物として空の paragraph が残ることが多く、それを本文ありと数えると、
 * 実際には何も書かれていないページで legacy Content を捨ててしまう。
 *
 * - ブロック 0 件            → 空
 * - 空 paragraph だけ        → 空
 * - 空白のみの paragraph だけ → 空
 * - divider / image / 等を含む → 空ではない
 */
export function isPageBodySemanticallyEmpty(blocks: readonly NotionBlock[]): boolean {
  return blocks.every(isBlockSemanticallyEmpty);
}
