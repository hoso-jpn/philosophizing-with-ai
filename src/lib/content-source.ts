import {
  fetchAllBlockChildren,
  isPageBodySemanticallyEmpty,
  type BlockChildrenFetcher,
  type NotionBlock,
} from './notion-blocks.ts';
import { usesPageBodySource } from './migration-allowlist.ts';

/**
 * 記事本文の source を明示する層。
 *
 * これまで本文は `Post.content: string` 一本で、記事ページが `marked(post.content)` を
 * 呼んでいた。文字列だけでは「legacy の Content プロパティ」と「Notion のページ本文
 * （block の配列）」を区別できないので、どちらであるかを型で持たせる。
 *
 * 描画はここでは行わない。Issue #5 の renderer が kind で分岐して
 * blocks を typed AST へ変換する。
 */
export type ArticleContentSource =
  /** Blog Database の Content rich_text プロパティ。既存記事はすべてこちら */
  | { kind: 'legacy'; content: string }
  /** Notion のページ本文。移行済み記事だけがこちら */
  | { kind: 'notion-page'; pageId: string; blocks: NotionBlock[] };

/** source 解決に必要な、記事 1 件分の入力 */
export type ContentSourceInput = {
  /** Notion のページ ID。ページ本文の取得先 */
  id: string;
  slug: string;
  /** legacy Content プロパティから組み立てた本文。無ければ空文字 */
  content: string;
};

export type ContentSourceDeps = {
  /** ページ本文を取得する。失敗したら投げること（空配列を返してはならない） */
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
    return { kind: 'notion-page', pageId: article.id, blocks };
  }

  if (legacy.trim()) return { kind: 'legacy', content: legacy };
  throw new MissingArticleContentError(article.slug, article.id);
}

/**
 * Notion のページ本文に対して URL / 画像の不変条件が実装済みか。
 *
 * **Issue #6 が完了したら true にする。それがこのフラグの唯一の用途。**
 *
 * legacy Content には次の検査が掛かっている（すべて `post.content` が対象）。
 *
 *   - assertNoSelfReferencingUrls … 自サイトへの絶対 URL と /posts/<UUID> を止める（D-13 / D-19）
 *   - countReferencedHosts        … 参照ホストの一覧をビルドログへ出す（D-20）
 *   - localizeContentImages       … 本文画像をローカルへ取り込む
 *   - assertNoExternalContentImages … ローカル化の事後条件
 *
 * ページ本文（blocks）にはまだ 1 つも掛かっていない。この状態で移行済み記事を
 * 公開すると、自サイト絶対 URL や期限付き S3 画像がそのまま出る。
 *
 * 「#6 の前に allowlist を有効化しない」をコメントで約束するのはやめる。
 * 実際、これを止めていたのは src/pages/posts/[slug].astro の暫定 throw だけで、
 * **Issue #5 が renderer を入れてその throw を消した瞬間に、検査の穴が音もなく開く**。
 * データ層に置いたこの guard は renderer の有無と無関係に効き続ける。
 */
export const PAGE_BODY_INVARIANTS_IMPLEMENTED = false;

export class UnguardedPageBodySourceError extends Error {
  constructor(slugs: string[]) {
    super(
      `Notion のページ本文を本文 source にした記事が ${slugs.length} 件ありますが、` +
        `ページ本文には URL / 画像の不変条件がまだ実装されていません（Issue #6）。\n` +
        slugs.map((slug) => `  - ${slug}`).join('\n') +
        '\n\n' +
        'legacy Content には掛かっている次の検査が、ページ本文には掛かりません。\n' +
        '  - 自サイトへの絶対 URL / Notion のページ ID を指す URL の検出（D-13 / D-19）\n' +
        '  - 本文画像のローカル化と、外部 URL が残っていないことの事後条件\n\n' +
        'このまま公開すると、内部リンクがドメイン変更で壊れ、期限付きの S3 画像が\n' +
        '1 時間後に全滅します。次のどちらかを行ってください。\n' +
        '  1. src/lib/migration-allowlist.ts から slug を外す（legacy Content へ戻ります）\n' +
        '  2. Issue #6 を実装し、src/lib/content-source.ts の\n' +
        '     PAGE_BODY_INVARIANTS_IMPLEMENTED を true にする',
    );
    this.name = 'UnguardedPageBodySourceError';
  }
}

/**
 * 不変条件が未実装のページ本文が公開経路へ進んでいないことを確かめる。
 *
 * 取得パイプラインの中で呼ぶ。記事ページのテンプレートではなくここに置くのは、
 * テンプレート側の throw が Issue #5 で renderer に置き換わって消えるため。
 * ここなら renderer が入っても、#6 が済むまでビルドが止まり続ける。
 *
 * allowlist が空のあいだ `notion-page` は 1 件も生まれないので、この検査は
 * 現状の全記事に対して素通りする。
 */
export function assertPageBodySourcesAreGuarded(
  articles: readonly { slug: string; contentSource: ArticleContentSource }[],
  invariantsImplemented: boolean = PAGE_BODY_INVARIANTS_IMPLEMENTED,
): void {
  if (invariantsImplemented) return;

  const unguarded = articles
    .filter((article) => article.contentSource.kind === 'notion-page')
    .map((article) => article.slug);

  if (unguarded.length > 0) throw new UnguardedPageBodySourceError(unguarded);
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
