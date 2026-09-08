import {
  fetchAllBlockChildren,
  isPageBodySemanticallyEmpty,
  type BlockChildrenFetcher,
  type NotionBlock,
} from './notion-blocks.ts';
import { buildArticleDocument } from './notion-normalize.ts';
import { usesPageBodySource } from './migration-allowlist.ts';
import type { ArticleDocument } from './article-document.ts';

/**
 * 記事本文の source を明示する層。
 *
 * これまで本文は `Post.content: string` 一本で、記事ページが `marked(post.content)` を
 * 呼んでいた。文字列だけでは「legacy の Content プロパティ」と「Notion のページ本文
 * （block の配列）」を区別できないので、どちらであるかを型で持たせる。
 *
 * 描画はここでは行わない。分岐して描くのは記事ページ側。
 *
 * **notion-page は生ブロックではなく ArticleDocument を持つ。** Notion の API 形状を
 * 知ってよいのは lib/notion-normalize.ts までで、そこから先（記事ページ・
 * コンポーネント）へは正規化済みの木だけを渡す。生ブロックを持ち回すと、描画側が
 * API 形状の判定を持ち始め、Notion の API バージョンを上げた時点で壊れる（D-38）。
 */
export type ArticleContentSource =
  /** Blog Database の Content rich_text プロパティ。既存記事はすべてこちら */
  | { kind: 'legacy'; content: string }
  /** Notion のページ本文。移行済み記事だけがこちら */
  | { kind: 'notion-page'; pageId: string; document: ArticleDocument };

/** source 解決に必要な、記事 1 件分の入力 */
export type ContentSourceInput = {
  /** Notion のページ ID。ページ本文の取得先 */
  id: string;
  slug: string;
  /** legacy Content プロパティから組み立てた本文。無ければ空文字 */
  content: string;
};

export type ContentSourceDeps = {
  /**
   * ブロックの子を取得する。失敗したら投げること（空配列を返してはならない）。
   *
   * ページ本文の取得と入れ子ブロックの取得はどちらも `blocks/<id>/children` なので、
   * 正規化中の子の取得にもこの同じ関数を渡す。呼び出し側がメモ化していれば、
   * 同じブロックを 2 度取りに行かない。
   */
  fetchPageBlocks: (pageId: string) => Promise<NotionBlock[]>;
  /** 移行済みかの判定。既定は版管理された allowlist */
  usesPageBody?: (slug: string) => boolean;
};

export class MissingArticleContentError extends Error {
  constructor(slug: string, pageId: string) {
    super(
      `記事「${slug}」に本文がありません（Notion ページ ${pageId}）。\n` +
        `  - Notion のページ本文: 取得できましたが空でした\n` +
        `  - legacy Content プロパティ: 空です\n` +
        `どちらかに本文を書いてください。空の記事を公開しないためビルドを止めます。`,
    );
    this.name = 'MissingArticleContentError';
  }
}

/**
 * 記事 1 件の本文 source を決める。
 *
 *     slug が allowlist 外
 *       → legacy Content
 *
 *     slug が allowlist 内
 *       → ページ本文を取得
 *           ├─ 意味のある本文あり → notion-page
 *           └─ 正常に取得できたが空 → legacy Content
 *
 * **API の失敗を「本文が空」として扱わない。** fetchPageBlocks が投げた例外は
 * ここで一切握り潰さず、そのままビルドの失敗にする。ネットワーク断・timeout・
 * 429・5xx・壊れた応答・ページネーション途中の失敗はすべてこれに当たる。
 *
 * 握り潰して legacy へ落とすと、Notion の一時的な障害のたびに移行済み記事の本文が
 * 黙って古い内容へ戻り、しかもビルドは成功するので誰も気づけない。落として直前の
 * 正常なデプロイを残す方が安全である（Vercel は成功したビルドにだけ本番エイリアスを張る）。
 *
 * legacy へ落ちてよいのは、**取得そのものが正常に終わり、本文が意味的に空だと
 * 判断できた場合だけ**。
 */
export async function resolveArticleContentSource(
  article: ContentSourceInput,
  deps: ContentSourceDeps,
): Promise<ArticleContentSource> {
  const usesPageBody = deps.usesPageBody ?? usesPageBodySource;
  const legacy = article.content;

  if (!usesPageBody(article.slug)) {
    // 移行対象外。ページ本文があっても見に行かない（取得の副作用も持ち込まない）
    if (!legacy.trim()) throw new MissingArticleContentError(article.slug, article.id);
    return { kind: 'legacy', content: legacy };
  }

  // ここで投げられた例外は捕まえない。それが Issue #4 の要点
  const blocks = await deps.fetchPageBlocks(article.id);

  if (!isPageBodySemanticallyEmpty(blocks)) {
    // 正規化も失敗を握り潰さない。未対応のブロックがあれば例外になり、
    // 本文の一部が欠けたまま公開されることはない（Issue #5）
    const document = await buildArticleDocument(blocks, {
      slug: article.slug,
      pageId: article.id,
      fetchChildren: deps.fetchPageBlocks,
    });
    return { kind: 'notion-page', pageId: article.id, document };
  }

  if (legacy.trim()) return { kind: 'legacy', content: legacy };
  throw new MissingArticleContentError(article.slug, article.id);
}

/**
 * ページ本文の取得を組み立てる。
 *
 * ビルド 1 回のあいだ、同じページを 2 度取りに行かない。getPosts はメモ化されている
 * ので通常は 1 回で済むが、#5 で renderer からも本文が要るようになったときに
 * 取得が増えないようにしておく。キャッシュはプロセス内だけで、ビルドをまたいで
 * 持ち越さない（1 ビルド = 1 スナップショット、D-26）。
 *
 * 失敗した Promise もそのまま保持する。同じビルド内で結果が変わらない方がよい。
 */
export function createPageBodyLoader(
  fetchPage: BlockChildrenFetcher,
  { cache = true }: { cache?: boolean } = {},
): (pageId: string) => Promise<NotionBlock[]> {
  const inFlight = new Map<string, Promise<NotionBlock[]>>();

  return (pageId: string) => {
    if (!cache) return fetchAllBlockChildren(pageId, fetchPage);
    const cached = inFlight.get(pageId);
    if (cached) return cached;
    const pending = fetchAllBlockChildren(pageId, fetchPage);
    inFlight.set(pageId, pending);
    return pending;
  };
}
