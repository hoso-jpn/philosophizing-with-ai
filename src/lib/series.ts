/**
 * シリーズ（「AIと哲学01；…」のような連番付きの連載）判定ヘルパー。
 *
 * 判定の優先順位:
 *   1. Notion 側に明示的な Series プロパティがあれば、それをそのまま使う
 *   2. Notion の「名前」プロパティ（タイトル先頭の連番付きラベル。例: "AIと実装01"）
 *   3. 表示用タイトルの区切り文字より前の部分（後方互換のためのフォールバック）
 *
 * 「AIと◯◯」をハードコードせず、「ラベル＋連番」という命名規則そのものを
 * 判定条件にしているため、新しいシリーズが増えてもコード変更は不要。
 */

/** 既知シリーズの表示順。ここに無いシリーズは、この後ろに初出順で並ぶ。 */
export const SERIES_DISPLAY_ORDER: readonly string[] = [
  'AIと哲学',
  'AIと生物学',
  'AIと統計学',
  'AIと実装',
];

export type SeriesSourcePost = {
  title?: string | null;
  /** Notion の「名前」プロパティ（例: "AIと実装01"） */
  titlePrefix?: string | null;
  /** Notion に明示的な Series プロパティがある場合の値 */
  series?: string | null;
};

/** タイトルの「ラベル」と「本文」を分ける区切り文字（全角/半角の揺れを吸収） */
const SEPARATOR = /[；;：:]/;

/**
 * 「非数字で始まり、非数字で終わるラベル」＋「1〜3桁の連番」。
 * ラベル末尾を非数字に限定することで、"2026年の記録" のような
 * 数字で終わる通常タイトルを誤判定しない。
 */
const SERIES_LABEL = /^([^0-9０-９](?:[^；;：:]*[^0-9０-９\s])?)[\s]*[0-9０-９]{1,3}$/;

/** シリーズ名として許容する最大長（通常の文章が誤判定されるのを防ぐ保険） */
const MAX_SERIES_NAME_LENGTH = 32;

/** "AIと実装01" のような連番付きラベルからシリーズ名を取り出す。 */
export function parseSeriesLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const matched = label.trim().match(SERIES_LABEL);
  if (!matched) return null;
  const name = matched[1].trim();
  if (!name || name.length > MAX_SERIES_NAME_LENGTH) return null;
  return name;
}

/** "AIと実装01；本文…" のような表示用タイトルからシリーズ名を取り出す。 */
export function parseSeriesFromTitle(title: string | null | undefined): string | null {
  if (!title || !SEPARATOR.test(title)) return null;
  return parseSeriesLabel(title.split(SEPARATOR)[0]);
}

/** 記事 1 件のシリーズ名を返す。シリーズに属さない記事は null。 */
export function getSeriesName(post: SeriesSourcePost): string | null {
  const explicit = post.series?.trim();
  if (explicit) return explicit;
  return parseSeriesLabel(post.titlePrefix) ?? parseSeriesFromTitle(post.title);
}

/**
 * 記事をシリーズごとにまとめる。
 * 既知シリーズは SERIES_DISPLAY_ORDER の順、未知シリーズはその後ろに初出順。
 * 各シリーズ内の記事順は、渡された配列の順序をそのまま維持する。
 */
export function groupPostsBySeries<T extends SeriesSourcePost>(
  posts: readonly T[],
): { name: string; posts: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const post of posts) {
    const name = getSeriesName(post);
    if (!name) continue;
    const bucket = groups.get(name);
    if (bucket) bucket.push(post);
    else groups.set(name, [post]);
  }

  const rank = (name: string) => {
    const index = SERIES_DISPLAY_ORDER.indexOf(name);
    return index === -1 ? SERIES_DISPLAY_ORDER.length : index;
  };

  // Map は挿入順を保つため、未知シリーズは初出順（＝公開日順）で後続に並ぶ
  return [...groups.entries()]
    .map(([name, seriesPosts]) => ({ name, posts: seriesPosts }))
    .sort((a, b) => rank(a.name) - rank(b.name));
}
