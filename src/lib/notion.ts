import { getMinExpectedPosts, getNotionApiKey, getNotionDatabaseId } from './env.ts';
import { assertNoLegacyDomainReferences, parsePost, type ParseWarning } from './notion-schema.ts';
import {
  assertNoExternalContentImages,
  localizeContentImages,
  saveImageLocally,
} from './download-image.ts';
import type { Post } from './types.ts';

const NOTION_VERSION = '2022-06-28';

/**
 * Notion API 呼び出し。
 * 失敗を握り潰さず必ず投げる。以前は catch して [] を返していたため、
 * トークン失効も API 障害も「記事0本のサイト」として正常終了していた。
 */
async function notionFetch(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${getNotionApiKey()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Notion API への ${path} が失敗しました: ${response.status} ${response.statusText}\n${detail.slice(0, 500)}`,
    );
  }
  return response.json();
}

/** ページネーションを辿って全件取得する */
async function queryDatabase(filter?: unknown, sorts?: unknown): Promise<unknown[]> {
  const databaseId = getNotionDatabaseId();
  const results: unknown[] = [];
  let cursor: string | undefined;

  do {
    const page = await notionFetch(`databases/${databaseId}/query`, {
      filter,
      sorts,
      page_size: 100,
      start_cursor: cursor,
    });
    results.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);

  return results;
}

function reportWarnings(warnings: ParseWarning[]): void {
  for (const w of warnings) console.warn(`[notion] ${w.slug}: ${w.message}`);
}

/**
 * 外部を指している画像をローカルへ取り込む。
 *
 * HeroImage は署名付き S3 URL で有効期限が 1 時間（2026-09-03 実測）。
 * SSR の間は毎リクエスト取り直していたので露見しなかったが、SSG 化すると
 * URL がビルド時に HTML へ焼き込まれ、1 時間後に画像が全滅する。
 *
 * 本文画像は assertNoExternalContentImages が外部 URL を弾いたあとに通るので、
 * localizeContentImages はサイト内パス（/images/...）を素通しするだけになる。
 * ダウンロードが実際に働くのは Phase 5（本文を Notion のページ本文へ移し、
 * 画像が Notion の画像ブロックになったとき）。
 */
async function localizeImages(post: Post): Promise<Post> {
  return {
    ...post,
    heroImage: post.heroImage ? await saveImageLocally(post.heroImage, post.slug) : null,
    content: await localizeContentImages(post.content, post.slug),
  };
}

const publishedFilter = { property: 'Published', checkbox: { equals: true } };
const dateAscending = [{ property: 'Date', direction: 'ascending' }];

/**
 * 公開記事を公開日の昇順で取得する。
 * 0 件、または想定を大きく下回る件数だった場合は例外にしてビルドを止める。
 */
export async function getPosts(): Promise<Post[]> {
  const rows = await queryDatabase(publishedFilter, dateAscending);

  const warnings: ParseWarning[] = [];
  const posts = rows.map((row) => parsePost(row, warnings));
  reportWarnings(warnings);

  const minimum = getMinExpectedPosts();
  // 件数チェックの成否にかかわらず出す。下限が実態から乖離していることに気づけるようにするため。
  // 取得自体が失敗した場合は notionFetch がここより前に投げるので、この行は出ない
  console.log(`[notion] ${posts.length} posts fetched (floor: ${minimum})`);

  if (posts.length === 0) {
    throw new Error(
      'Notion から公開記事を 1 件も取得できませんでした。' +
        'Published にチェックの入った記事があるか、認証情報が有効かを確認してください。',
    );
  }
  if (posts.length < minimum) {
    throw new Error(
      `公開記事が ${posts.length} 件しかありません（下限 ${minimum} 件）。` +
        '意図的に記事を減らした場合は環境変数 MIN_EXPECTED_POSTS で下限を調整してください。',
    );
  }

  // 件数ログのあとに検査する。取得できた件数は先に見せたい。
  // 対象は公開記事だけ（下書きは上の Published フィルタで取得されない）。
  //
  // 旧ドメインの検査はローカル化より前に置く。停止済みだと分かっているドメインには
  // 「取得に失敗しました（404）」より「旧ドメインは停止済み。リンクは /posts/<slug>/ へ」
  // の方が直すべきことを直接指すため。リンクはそもそもローカル化の対象外でもある。
  assertNoLegacyDomainReferences(posts);

  const localized = await Promise.all(posts.map(localizeImages));

  // ローカル化を通したあとの事後条件。外部 URL が残っていたら実装の異常
  assertNoExternalContentImages(localized);

  return localized;
}

/** webhook のフィルタに必要な最小限だけを読んだページの状態 */
export type PagePublishState = {
  /** Published チェックボックスの現在値。プロパティが読めなければ null */
  published: boolean | null;
  /** ログ用。Slug が空ならページ ID を入れる */
  slug: string;
  /** Published プロパティの ID。updated_properties との突き合わせに使う */
  publishedPropertyId: string | null;
};

/**
 * ページ 1 件の公開状態だけを取得する（webhook のフィルタ用）。
 *
 * parsePost は使わない。あれは「公開できる記事か」を検証するもので、Slug や
 * Content が空なら例外を投げる。webhook が見に行くページは執筆途中の下書きが
 * 大半で、それらは当然空なので、検証を通すと下書き保存のたびに 500 を返して
 * Notion に 24 時間リトライさせることになる。ここは Published と Slug だけを緩く読む。
 *
 * 取得自体に失敗した場合は例外を投げる（呼び出し側で安全側に倒す）。
 */
export async function getPagePublishState(pageId: string): Promise<PagePublishState> {
  const page = await notionFetch(`pages/${pageId}`);
  const published = page?.properties?.Published;
  const slug = (page?.properties?.Slug?.rich_text ?? [])
    .map((t: { plain_text?: string }) => t?.plain_text ?? '')
    .join('')
    .trim();

  return {
    published: typeof published?.checkbox === 'boolean' ? published.checkbox : null,
    slug: slug || pageId,
    publishedPropertyId: typeof published?.id === 'string' ? published.id : null,
  };
}
