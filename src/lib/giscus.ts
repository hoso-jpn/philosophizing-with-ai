export type GiscusConfig = {
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
};

/** 未設定なら記事だけを公開する。片方だけの設定は誤設定としてビルドを止める。 */
export function resolveGiscusConfig(env: {
  PUBLIC_GISCUS_CATEGORY?: string;
  PUBLIC_GISCUS_CATEGORY_ID?: string;
}): GiscusConfig | null {
  const category = env.PUBLIC_GISCUS_CATEGORY?.trim() ?? '';
  const categoryId = env.PUBLIC_GISCUS_CATEGORY_ID?.trim() ?? '';
  if (!category && !categoryId) return null;
  if (!category || !/^DIC_[A-Za-z0-9_-]+$/.test(categoryId)) {
    throw new Error('PUBLIC_GISCUS_CATEGORY と有効な PUBLIC_GISCUS_CATEGORY_ID を両方設定してください。');
  }
  return {
    repo: 'hoso-jpn/philosophizing-with-ai',
    // GitHub repository node_id (2026-09-10取得)。数値のrepository IDとは異なる。
    repoId: 'R_kgDORl9JSg',
    category,
    categoryId,
  };
}
