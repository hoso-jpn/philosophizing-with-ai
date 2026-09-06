/**
 * 記事本文の描画モデル。
 *
 * **ここに Notion の型は 1 つも出てこない。** それが目的。Notion API の生 JSON を
 * そのまま Astro コンポーネントへ渡すと、
 *
 *   - コンポーネントが `'paragraph' in block` のような API 形状の判定を持ち始める
 *   - Notion の API バージョンを上げると描画側が壊れる（Issue #14）
 *   - 未対応のブロックが `undefined` を辿って静かに消える
 *
 * の 3 つが同時に起きる。Notion の生ブロックからこのモデルへの変換は
 * src/lib/notion-normalize.ts だけが行い、描画側はこのモデルだけを読む。
 *
 * legacy `Content` プロパティは従来どおり marked で描画する。あちらは HTML 文字列で
 * あってブロックの木ではないので、同じモデルには載せない（D-38）。
 */

/**
 * 本文中の文字列 1 断片。
 *
 * インライン数式を素のテキストへ潰さない。`$x^2$` のような文字列にしてしまうと
 * 数式だった事実が失われ、Issue #7 で KaTeX を入れるときに正規表現で推測し直す
 * ことになる（Issue #7 が明示的に禁じている）。型で分けて持つ。
 */
export type ArticleRichText =
  | {
      kind: 'text';
      text: string;
      bold: boolean;
      italic: boolean;
      strikethrough: boolean;
      underline: boolean;
      code: boolean;
      /** 正規化済みのリンク先。危険なスキームは正規化の時点で落としてある */
      href: string | null;
    }
  /** インライン数式。KaTeX 化は Issue #7 */
  | { kind: 'equation'; expression: string };

/** callout のアイコン。表示の作り込みは後続でよいが、情報は捨てない */
export type ArticleIcon =
  | { kind: 'emoji'; emoji: string }
  | { kind: 'url'; url: string };

/**
 * 画像の取得元。
 *
 * `file` は Notion がホストする署名付き URL で **有効期限がある**。この URL を
 * そのまま HTML へ出してはならない（Issue #6 でローカル化する）。型で区別して
 * 持っておき、描画側が誤って素通しできないようにする。
 */
export type ArticleImageSource =
  | { kind: 'notion-hosted'; url: string; expiryTime: string | null }
  | { kind: 'external'; url: string };

export type ArticleListItem = {
  id: string;
  richText: ArticleRichText[];
  /** 入れ子のリストなど。順序はそのまま保つ */
  children: ArticleBlock[];
};

export type ArticleTableRow = {
  id: string;
  /** セルごとの rich text。列数は行によって変わりうるので配列のまま持つ */
  cells: ArticleRichText[][];
};

export type ArticleBlock =
  | { kind: 'paragraph'; id: string; richText: ArticleRichText[] }
  | { kind: 'heading'; id: string; level: 1 | 2 | 3; richText: ArticleRichText[] }
  /** 連続する list item をまとめたもの。Notion は 1 行ずつ返すのでここで束ねる */
  | { kind: 'list'; ordered: boolean; items: ArticleListItem[] }
  | { kind: 'quote'; id: string; richText: ArticleRichText[]; children: ArticleBlock[] }
  | { kind: 'callout'; id: string; richText: ArticleRichText[]; icon: ArticleIcon | null; children: ArticleBlock[] }
  | { kind: 'divider'; id: string }
  | { kind: 'code'; id: string; code: string; language: string | null; caption: ArticleRichText[] }
  /** 描画は Issue #6。ここでは取得元・caption・alt を失わずに持つだけ */
  | { kind: 'image'; id: string; source: ArticleImageSource; caption: ArticleRichText[]; alt: string | null }
  /** 描画は Issue #7。expression をそのまま持つ */
  | { kind: 'equation'; id: string; expression: string }
  /** 描画は Issue #7。行・セル・ヘッダ情報を持つ */
  | {
      kind: 'table';
      id: string;
      hasColumnHeader: boolean;
      hasRowHeader: boolean;
      rows: ArticleTableRow[];
    };

export type ArticleDocument = { blocks: ArticleBlock[] };

/** 今回 renderer まで用意したブロック */
const RENDERABLE_KINDS = new Set<ArticleBlock['kind']>([
  'paragraph',
  'heading',
  'list',
  'quote',
  'callout',
  'divider',
  'code',
]);

/** 正規化はするが描画は後続 Issue に送るブロックと、その担当 Issue */
const DEFERRED_KINDS: Partial<Record<ArticleBlock['kind'], { issue: string; reason: string }>> = {
  image: {
    issue: 'Issue #6',
    reason:
      'Notion がホストする画像 URL は署名付きで有効期限があるため、ビルド時に' +
      'ローカルへ取り込むまで HTML へ出せません',
  },
  equation: { issue: 'Issue #7', reason: 'KaTeX による数式描画がまだありません' },
  table: { issue: 'Issue #7', reason: '科学記事向けの table 描画がまだありません' },
};

/**
 * 描画がまだ用意できていないブロックに当たったことを表す例外。
 *
 * **黙って飛ばさない。** 空で描くと、図や数式や表が丸ごと抜けた記事が
 * 「正常にビルドできた記事」として公開される。落として気づけるようにする。
 */
export class DeferredArticleBlockError extends Error {
  constructor(
    kind: ArticleBlock['kind'],
    context: { slug?: string; blockId?: string; inline?: boolean } = {},
  ) {
    const deferred = DEFERRED_KINDS[kind];
    const where = [
      context.slug ? `記事「${context.slug}」` : null,
      context.blockId ? `ブロック ${context.blockId}` : null,
    ]
      .filter(Boolean)
      .join(' / ');

    // インライン数式はブロックではないので、そう書かない。#8 の canary 記事は
    // 本文中に数式を含むため、どちらで落ちたのかが分かる必要がある
    const what = context.inline ? `インライン ${kind}` : `${kind} ブロック`;

    super(
      `${what}の描画はまだ実装されていません（${deferred?.issue ?? '後続 Issue'}）。` +
        (where ? `\n  ${where}` : '') +
        (deferred ? `\n  ${deferred.reason}` : '') +
        '\n本文の一部を黙って落とさないため、ビルドを止めます。',
    );
    this.name = 'DeferredArticleBlockError';
  }
}

/**
 * この記事を今の renderer で最後まで描けるかを、描画に入る前に確かめる。
 *
 * コンポーネント側でも同じ種別を弾くが、そちらはページの描画中に落ちるので
 * どの記事かが分かりにくい。ここで slug 付きの診断を出しておく。
 */
export function assertArticleDocumentRenderable(
  document: ArticleDocument,
  context: { slug?: string } = {},
): void {
  for (const block of document.blocks) assertBlockRenderable(block, context);
}

/**
 * rich text の中に描けないものが無いか確かめる。
 *
 * インライン数式はブロックではなく rich text 断片なので、`kind` を見るだけの
 * 走査からは漏れる。漏らすと最終的に ArticleRichText コンポーネントが落とすが、
 * そこには記事も断片の位置も無く、どの記事を直せばよいのか分からない診断になる。
 */
function assertRichTextRenderable(
  nodes: readonly ArticleRichText[],
  context: { slug?: string },
  blockId: string,
): void {
  for (const node of nodes) {
    if (node.kind === 'equation') {
      throw new DeferredArticleBlockError('equation', { ...context, blockId, inline: true });
    }
  }
}

function assertBlockRenderable(block: ArticleBlock, context: { slug?: string }): void {
  if (!RENDERABLE_KINDS.has(block.kind)) {
    throw new DeferredArticleBlockError(block.kind, {
      ...context,
      blockId: 'id' in block ? block.id : undefined,
    });
  }

  // 入れ子の中に未対応ブロックが隠れていても見つける
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
      assertRichTextRenderable(block.richText, context, block.id);
      return;

    case 'list':
      for (const item of block.items) {
        assertRichTextRenderable(item.richText, context, item.id);
        for (const child of item.children) assertBlockRenderable(child, context);
      }
      return;

    case 'quote':
    case 'callout':
      assertRichTextRenderable(block.richText, context, block.id);
      for (const child of block.children) assertBlockRenderable(child, context);
      return;

    case 'code':
      // code の本文は文字列なので走査しない。caption だけが rich text
      assertRichTextRenderable(block.caption, context, block.id);
      return;

    case 'divider':
      return;

    default:
      // image / equation / table は上の RENDERABLE_KINDS で既に落ちている
      return;
  }
}

/**
 * 装飾を内側から順に並べる。
 *
 * 描画順を 1 か所に固定しておくためのもの。コンポーネント側で if を積むと、
 * 入れ子の順序がコンポーネントごとにずれても誰も気づけない。
 *
 * `code` を最も内側に置くのは、コードの中身が装飾の一部として解釈されないため。
 * `a` を最も外側に置くのは、リンク全体が装飾された見た目になるようにするため。
 */
const DECORATION_ORDER = ['code', 'underline', 'strikethrough', 'italic', 'bold'] as const;

/**
 * 装飾に使う HTML タグ。**この 5 つ以外にはならない。**
 *
 * 描画側は受け取った文字列をそのまま要素名にするので、任意の文字列を許すと
 * Notion 由来の値をタグ名として渡す変更が型検査を通ってしまう。閉じた union に
 * しておくことで、その経路をコンパイル時に塞ぐ。
 */
export type DecorationTag = 'code' | 'u' | 'del' | 'em' | 'strong';

const DECORATION_TAGS: Record<(typeof DECORATION_ORDER)[number], DecorationTag> = {
  code: 'code',
  underline: 'u',
  strikethrough: 'del',
  italic: 'em',
  bold: 'strong',
};

/**
 * 1 断片を包むタグを、内側から外側の順に返す。
 * 例: bold + code → `['code', 'strong']`（`<strong><code>…</code></strong>`）
 */
export function decorationTags(node: ArticleRichText): DecorationTag[] {
  if (node.kind !== 'text') return [];
  return DECORATION_ORDER.filter((key) => node[key] === true).map((key) => DECORATION_TAGS[key]);
}
