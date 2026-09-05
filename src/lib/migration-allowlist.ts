/**
 * 本文を Notion のページ本文へ移した記事の slug 一覧。
 *
 * なぜ allowlist を置くのか:
 *
 * 「ページ本文が空でなければページ本文を使う」という判定だけにすると、移行期間中に
 * **意図しない記事まで新しい経路へ切り替わる**。Notion のページは編集の副産物として
 * 中身が残っていることがあり、legacy Content で公開中の記事のページ本文にたまたま
 * 何か書かれていれば、その瞬間に本文が差し替わってしまう。切り替えは記事単位で
 * 明示的に行いたいので、判定より前に版管理されたこの一覧を通す。
 *
 * 初期値は **空**。Issue #4 の時点では、この一覧が空である限り全記事が
 * これまでどおり legacy Content で描画され、公開中の記事の出力は変わらない。
 *
 * 最初の 1 件（AIと統計学03）を入れるのは Issue #8。その前に
 * Issue #5（typed renderer）と Issue #6（本文画像のローカル化）が要る。
 * renderer が無い状態でここへ slug を足すと、その記事のビルドは
 * src/pages/posts/[slug].astro で明示的に失敗する。
 *
 * 戻すときはこの配列から slug を消すだけでよい。
 */
export const PAGE_BODY_MIGRATED_SLUGS: readonly string[] = [];

const migrated = new Set(PAGE_BODY_MIGRATED_SLUGS);

/** その slug の本文を Notion のページ本文から取るか */
export function usesPageBodySource(slug: string): boolean {
  return migrated.has(slug);
}

/**
 * allowlist にあるが公開記事に存在しない slug を返す。
 *
 * 完全一致だけを見る。**typo を勝手に補正しない**（D-14 と同じ考え方で、
 * 誤ったソースをパイプラインで隠さず、書いた側を直してもらう）。大文字小文字の
 * 揺れや前後の空白も一致しない扱いにする。曖昧一致を入れると、意図しない記事が
 * ページ本文へ切り替わる余地を作ってしまい、allowlist を置いた意味が薄れる。
 *
 * @param publishedSlugs 公開記事の slug
 * @param allowlist 既定は版管理された一覧。差し替えられるのはテスト用
 */
export function findUnknownMigratedSlugs(
  publishedSlugs: Iterable<string>,
  allowlist: readonly string[] = PAGE_BODY_MIGRATED_SLUGS,
): string[] {
  const published = new Set(publishedSlugs);
  return allowlist.filter((slug) => !published.has(slug));
}

export class UnknownMigratedSlugError extends Error {
  constructor(slugs: string[]) {
    super(
      `migration allowlist の slug が公開記事に見つかりません（${slugs.length} 件）。\n` +
        slugs.map((slug) => `  - ${slug}`).join('\n') +
        '\n\n' +
        'このままだと「移行したつもりで 1 件も移行されていない」状態になります。\n' +
        '次のどれかです。\n' +
        '  - slug の綴りが違う（src/lib/migration-allowlist.ts を直す）\n' +
        '  - 対象記事がまだ非公開（Notion で Published にチェックを入れる）\n' +
        '  - 記事の slug を変えた、または記事を消した（allowlist から外す）\n\n' +
        'slug は完全一致で照合します。綴りの自動補正は行いません。',
    );
    this.name = 'UnknownMigratedSlugError';
  }
}
