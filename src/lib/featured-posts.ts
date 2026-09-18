/**
 * トップページ「初めての方へ」に出す代表記事の選定。
 *
 * ここが持つのは **編集上の判断だけ**、つまり「どの記事を、どの順で、どんな紹介文で
 * 入口に置くか」に限る。記事タイトル・URL・公開日は `getPosts()` が返す Notion の
 * スナップショットを正とする。
 *
 * タイトルを固定文字列として持たないのは、Notion 側で改題された瞬間に一覧と代表記事で
 * 別のタイトルが出るため。二重管理されたソースは、片方だけが古くなっても誰も気づけない
 * 形でしか壊れない（D-14 と同じ判断）。
 *
 * 公開記事一覧に無い slug は **リンクを作らない**。下書きへ戻した記事・削除した記事への
 * リンクを静かに生成すると、ビルドは成功したまま本番に 404 が出る。代わりに診断を返し、
 * 呼び出し側がビルドログへ出す。
 */

import { getSeriesName, type SeriesSourcePost } from './series.ts';
import { articlePath } from './site-urls.ts';

/** 代表記事 1 件ぶんの編集判断。 */
export type FeaturedPostSelection = {
  /** Notion の Slug プロパティ。公開記事一覧と完全一致で突き合わせる */
  slug: string;
  /**
   * トップページに出す短い紹介文。
   *
   * 公開本文を読んで書く。記事が説明していない内容を約束しない。
   * アクセス数の裏付けが無いので「人気」「よく読まれている」とは書かない。
   */
  summary: string;
};

/**
 * 「初めての方へ」に並べる代表記事。**配列の順序がそのまま表示順**になる。
 *
 * 選定の方針は「最新順に並べる」ではなく、
 *
 *   1. 初めて読む 1 本目として入りやすいこと
 *   2. 異なるシリーズ（＝異なるテーマ）への入口になること
 *
 * の 2 つ。公開記事に実在するシリーズの範囲で選び、シリーズ数を埋めるために
 * 内容の合わない記事を足さない。
 */
export const FEATURED_POST_SELECTIONS: readonly FeaturedPostSelection[] = [
  {
    slug: 'determinism-free-will-ai',
    summary:
      '「意思」は物理世界の外側から働く第五の力なのか。決定論と自由意志、そして未来への責任をどう考えるかをAIとの対話から整理した、このブログの哲学的な出発点です。',
  },
  {
    slug: 'ai-stats-data-bias-philosophy',
    summary:
      'データに基づく客観性は、どこで力になり、どこで偏見に変わるのか。実験計画法やA/Bテストを手がかりに、統計学とAIの「光と影」を考えます。',
  },
  {
    slug: 'apoptosis-regularization',
    summary:
      'アポトーシス（プログラム細胞死）と機械学習の正則化を並べて読み、「削ぎ落とすこと」が知能を洗練させるという見方を検討します。生物学と実装が交差する一本です。',
  },
  {
    slug: 'rtx-5090-qwen38-flash-next-freetoken',
    summary:
      'RTX 5090一枚で125B級のMoEモデルを動かし、測定した生成速度とPCIe・RAM帯域の上限まで記録した実装記事。抽象的な議論だけでなく、手を動かした検証も残しています。',
  },
];

/** 代表記事の解決に必要な、公開記事側の最小限の形。 */
export type FeaturedPostSource = SeriesSourcePost & {
  slug: string;
  title: string;
  date: string;
};

/** 表示に必要な値がすべて揃った代表記事。 */
export type FeaturedPost = {
  slug: string;
  /** Notion の表示タイトル。選定設定側では持たない */
  title: string;
  /** 内部リンク。既存の URL ヘルパーが作る相対パス（D-13） */
  href: string;
  /** ISO8601 の公開日 */
  date: string;
  /** シリーズ名。シリーズに属さない記事なら null */
  seriesName: string | null;
  summary: string;
};

export type FeaturedPostsResolution = {
  /** 解決できた代表記事。順序は選定設定のとおりで、同じ slug は 1 回しか出ない */
  posts: FeaturedPost[];
  /** ビルドログへ出す診断。空なら全件が公開記事へ解決できている */
  warnings: string[];
};

/**
 * 選定設定を、公開記事のスナップショットへ突き合わせる。
 *
 * 解決できなかった slug は落としたうえで診断に載せる。例外にしないのは、代表記事は
 * 読む順の提案であって公開の前提条件ではないため。記事が 1 件も無いこと自体の検知は
 * `getPosts()` 側の下限チェック（D-7）が担当で、そちらの保護はここでは触らない。
 */
export function resolveFeaturedPosts<T extends FeaturedPostSource>(
  posts: readonly T[],
  selections: readonly FeaturedPostSelection[] = FEATURED_POST_SELECTIONS,
): FeaturedPostsResolution {
  const bySlug = new Map<string, T>();
  for (const post of posts) if (!bySlug.has(post.slug)) bySlug.set(post.slug, post);

  const resolved: FeaturedPost[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const selection of selections) {
    const slug = selection.slug.trim();

    if (!slug) {
      warnings.push('[featured] slug が空の代表記事の設定があります。src/lib/featured-posts.ts を確認してください。');
      continue;
    }
    if (seen.has(slug)) {
      warnings.push(
        `[featured] ${slug}: 同じ記事が代表記事に 2 回指定されています。最初の 1 件だけを表示します。`,
      );
      continue;
    }
    seen.add(slug);

    const post = bySlug.get(slug);
    if (!post) {
      // 未公開・削除済みの記事へリンクを張らない。ここで落とさず黙って通すと、
      // ビルドが成功したまま本番のトップページから 404 へ誘導することになる
      warnings.push(
        `[featured] ${slug}: 公開記事一覧に見つからないため、代表記事から外しました。` +
          'Notion で Published を外した・Slug を変えた場合は src/lib/featured-posts.ts も更新してください。',
      );
      continue;
    }

    resolved.push({
      slug: post.slug,
      title: post.title,
      href: articlePath(post.slug),
      date: post.date,
      seriesName: getSeriesName(post),
      summary: selection.summary,
    });
  }

  return { posts: resolved, warnings };
}
