export const SITE_ORIGIN = 'https://blog.florigen.ai';

export const RSS_PATH = '/rss.xml';
export const SITEMAP_PATH = '/sitemap.xml';

export function articlePath(slugOrId: string): string {
  return `/posts/${slugOrId}`;
}

/** 本番の URL 契約: root 以外は末尾スラッシュ無し。 */
export function canonicalUrl(pathname: string, site: string | URL = SITE_ORIGIN): URL {
  const url = new URL(pathname, site);
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function absoluteSiteUrl(pathname: string, site: string | URL = SITE_ORIGIN): string {
  return canonicalUrl(pathname, site).toString();
}

/**
 * URL を XML のテキストノードへ入れられる形にする。
 *
 * **`new URL()` は `&` を percent encode しない。** path に `&` を含む slug
 * （Notion の Slug プロパティに文字種の検査は無い）がそのまま `<loc>` に入ると、
 * sitemap.xml が整形式でない XML になり、検索エンジンは **sitemap 全体**を
 * 読めなくなる。1 記事の問題が全 URL の問題になるので、出力の直前で必ず通す。
 *
 * `<` `>` は URL parser が percent encode するが、規則を 2 か所に分けない
 * ためここでも扱う。
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
