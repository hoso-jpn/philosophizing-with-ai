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
