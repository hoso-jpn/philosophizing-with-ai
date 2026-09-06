import { getMinExpectedPosts, getNotionApiKey, getNotionDatabaseId } from './env.ts';
import {
  assertNoSelfReferencingUrls,
  countReferencedHosts,
  formatReferencedHosts,
} from './content-links.ts';
import { parsePost, type ParseWarning } from './notion-schema.ts';
import {
  UnknownMigratedSlugError,
  findUnknownMigratedSlugs,
} from './migration-allowlist.ts';
import {
  assertPageBodySourcesAreGuarded,
  createPageBodyLoader,
  resolveArticleContentSource,
  type ArticleContentSource,
} from './content-source.ts';
import {
  assertNoExternalContentImages,
  localizeContentImages,
  saveImageLocally,
} from './download-image.ts';
import type { ParsedPost, Post } from './types.ts';

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

/**
 * ブロックの子を 1 ページ分取得する（ページ本文の取得もこれ）。
 *
 * `blocks/<id>/children` はページ本文の取得とブロックの子の取得を兼ねるので、
 * Issue #5 で `has_children` を辿るときもこの関数をそのまま使える。
 * 失敗は notionFetch がそのまま投げる。ここで握り潰さないことが Issue #4 の要点で、
 * 取得の失敗を「本文が空」と取り違えると移行済み記事が黙って古い本文へ戻る。
 */
function fetchBlockChildrenPage(blockId: string, cursor: string | null): Promise<unknown> {
  const query = new URLSearchParams({ page_size: '100' });
  if (cursor) query.set('start_cursor', cursor);
  return notionFetch(`blocks/${blockId}/children?${query}`);
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
async function localizeImages(post: ParsedPost): Promise<ParsedPost> {
  return {
    ...post,
    heroImage: post.heroImage ? await saveImageLocally(post.heroImage, post.slug) : null,
    content: await localizeContentImages(post.content, post.slug),
  };
}

const publishedFilter = { property: 'Published', checkbox: { equals: true } };
const dateAscending = [{ property: 'Date', direction: 'ascending' }];

/**
 * 1 ビルド = 1 スナップショット。
 *
 * index / blog / posts/[slug] / tags/[slug] / rss / sitemap がそれぞれ getPosts を
 * 呼ぶため、実測で 1 ビルドあたり 6 回 Notion を引いていた。回数そのものは
 * レート制限に対して十分小さいが、**ビルドの最中に Notion が編集されると
 * 一覧と個別ページで内容が食い違う**。性能ではなく一貫性のためにメモ化する。
 *
 * 解決済みの値ではなく Promise を持つので、並行呼び出しも 1 回にまとまる。
 * 失敗した Promise もそのまま保持する（同じビルド内で結果が変わらない方がよい）。
 *
 * dev サーバーではメモ化しない。Notion を編集して再読み込みしても反映されなくなる。
 */
let postsSnapshot: Promise<Post[]> | null = null;
const IS_DEV = Boolean(import.meta.env?.DEV);
const MEMOIZE = !IS_DEV;

/**
 * ページ本文の取得。ビルド 1 回のあいだ、同じページを 2 度取りに行かない。
 * dev サーバーではメモ化しない（Notion を編集して再読み込みしても反映されなくなる）。
 */
const loadPageBody = createPageBodyLoader(fetchBlockChildrenPage, { cache: MEMOIZE });

export function getPosts(): Promise<Post[]> {
  if (!MEMOIZE) return fetchPosts();
  postsSnapshot ??= fetchPosts();
  return postsSnapshot;
}

/**
 * 公開記事を公開日の昇順で取得する。
 * 0 件、または想定を大きく下回る件数だった場合は例外にしてビルドを止める。
 */
async function fetchPosts(): Promise<Post[]> {
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

  // 移行 allowlist の綴り違い・取り残しをここで見つける。件数チェックのあと、
  // ページ本文の取得より前に置く。「移行したつもりで 1 件も移行されていない」
  // 状態を静かに許さないため
  assertMigrationAllowlistMatches(posts.map((post) => post.slug));

  // 本文が参照している全ホストを出す。禁止リストは漏れるが一覧は漏れない。
  // 実際、特定文字列だけを見ていたために旧プレビューホストへの参照を取りこぼした
  console.log('[content] 参照ホスト一覧:');
  for (const line of formatReferencedHosts(countReferencedHosts(posts))) console.log(line);

  // 検査は件数ログのあと。取得できた件数は先に見せたい。
  // 対象は公開記事だけ（下書きは上の Published フィルタで取得されない）。
  //
  // ローカル化より前に置く。自サイトを指す URL は「取得に失敗しました（404）」より
  // 「相対パスへ書き換える」の方が直すべきことを直接指すため。
  // リンク（<a href>）はそもそもローカル化の対象外でもある。
  assertNoSelfReferencingUrls(posts);

  const localized = await Promise.all(posts.map(localizeImages));

  // ローカル化を通したあとの事後条件。外部 URL が残っていたら実装の異常
  assertNoExternalContentImages(localized);

  return resolveContentSources(localized);
}

/**
 * migration allowlist の slug が実在の公開記事を指していることを確かめる。
 *
 * allowlist は完全一致の照合しかしないので、綴りを 1 文字間違えるとその記事は
 * legacy のまま何事もなくビルドが通る。fail closed ではあるが、「移行したつもりで
 * 実際には 1 件も移行されていない」状態を静かに許すことになる。#8 で canary の
 * slug を有効化するとき、その取り違えに気づけるようにしておく。
 *
 * 本番ビルドでは落とす。dev では警告に留める。dev は Notion 側を編集しながら
 * 動かす場で、対象記事を Published にする前に allowlist を先に書くことがあるため。
 * 本番へ出る経路（production build）は従来どおり fail closed。
 */
function assertMigrationAllowlistMatches(publishedSlugs: string[]): void {
  const unknown = findUnknownMigratedSlugs(publishedSlugs);
  if (unknown.length === 0) return;

  const error = new UnknownMigratedSlugError(unknown);
  if (!IS_DEV) throw error;
  console.warn(`[content] ${error.message}`);
}

/**
 * 記事ごとに本文の正本を決める。
 *
 * ローカル化のあとに置く。legacy source の中身はローカル化を通した本文そのもので
 * なければならず、先に決めてしまうと `contentSource.content` だけ画像 URL が
 * 書き換わっていない、という食い違いが生まれる。
 *
 * migration allowlist が空のあいだ、ここは全記事について legacy を返すだけで、
 * Notion への追加の問い合わせも起きない。
 */
async function resolveContentSources(posts: ParsedPost[]): Promise<Post[]> {
  const resolved = await Promise.all(
    posts.map(async (post) => ({
      ...post,
      // 失敗を握り潰さない。Notion の障害を「本文が空」と取り違えて legacy へ
      // 戻すと、移行済み記事が黙って古い本文で公開される（Issue #4）
      contentSource: await resolveArticleContentSource(post, { fetchPageBlocks: loadPageBody }),
    })),
  );

  reportContentSources(resolved);

  // ページ本文には URL / 画像の不変条件がまだ掛かっていない（Issue #6）。
  // 記事ページのテンプレートではなくここで止める。あちらの throw は Issue #5 で
  // renderer に置き換わって消えるが、この検査は残り続ける。
  // 内訳のログより後に置く。何が引っかかったかを先に見せたい
  assertPageBodySourcesAreGuarded(resolved);

  return resolved;
}

/**
 * 本文 source の内訳をビルドログへ出す。
 *
 * 移行は記事単位で少しずつ進むので、「いま何本がページ本文で描かれているか」は
 * 毎ビルド目に見えている必要がある。allowlist に入れたのに legacy へ落ちている
 * 記事（ページ本文が空だった）にも、ここで気づける。
 */
function reportContentSources(posts: Post[]): void {
  const byKind = new Map<ArticleContentSource['kind'], string[]>();
  for (const post of posts) {
    const bucket = byKind.get(post.contentSource.kind);
    if (bucket) bucket.push(post.slug);
    else byKind.set(post.contentSource.kind, [post.slug]);
  }

  const pageBody = byKind.get('notion-page') ?? [];
  console.log(
    `[content] 本文 source: legacy ${(byKind.get('legacy') ?? []).length} 件 / ` +
      `notion-page ${pageBody.length} 件`,
  );
  for (const slug of pageBody) console.log(`  notion-page: ${slug}`);
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
