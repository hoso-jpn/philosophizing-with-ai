// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = 'Philosophizing with AI';
export const SITE_DESCRIPTION = '履歴依存的創発主義から探求する、AI時代の「良く生きる」方法';

/**
 * トップページ専用のメタデータと紹介文。
 *
 * `SITE_TITLE` / `SITE_DESCRIPTION` はサイト全体の既定値として据え置き、トップだけの
 * 値はここから `BaseHead` の props として渡す。共通の定数そのものを書き換えると、
 * blog / tags / RSS など `SITE_DESCRIPTION` を使う他ページの出力まで一緒に変わる。
 */
export const HOME_HEADING = 'AIと哲学・研究・実装の記録';

export const HOME_PAGE_TITLE = `${HOME_HEADING} | ${SITE_TITLE}`;

export const HOME_META_DESCRIPTION =
  'AIとの対話、研究、実装を通じて、意識・自由意志・価値や意味、統計学・生物学・AI技術を考える個人ブログ。各シリーズの代表記事から、関心のあるテーマを読み始められます。';

/** 主見出しの直後に置く紹介文。段落ごとに 1 要素。 */
export const HOME_INTRO_PARAGRAPHS: readonly string[] = [
  'AIとの対話と、研究・実装の経験を手がかりに、意識・自由意志・価値や意味、統計学や生命の仕組みを考える個人ブログです。',
  '哲学的な考察からAIの技術検証まで、根拠と推論、筆者の立場を区別しながら記録しています。',
];
