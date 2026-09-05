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
