import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  absoluteSiteUrl,
  articlePath,
  canonicalUrl,
  RSS_PATH,
  SITEMAP_PATH,
  SITE_ORIGIN,
  xmlEscape,
} from './site-urls.ts';

describe('site URL contract', () => {
  it('記事・RSS・sitemap の path を一元化する', () => {
    assert.equal(articlePath('ai-stat-03'), '/posts/ai-stat-03');
    assert.equal(RSS_PATH, '/rss.xml');
    assert.equal(SITEMAP_PATH, '/sitemap.xml');
  });

  it('root 以外の canonical から末尾スラッシュを除く', () => {
    assert.equal(canonicalUrl('/posts/ai-stat-03/').toString(), `${SITE_ORIGIN}/posts/ai-stat-03`);
    assert.equal(canonicalUrl('/').toString(), `${SITE_ORIGIN}/`);
  });

  it('sitemap 用の絶対 URL も同じ規則を使う', () => {
    assert.equal(absoluteSiteUrl('/tags/statistics/'), `${SITE_ORIGIN}/tags/statistics`);
  });

  // canonical（Astro.url.pathname は encode 済み）と sitemap（生の文字列から
  // 組み立てる）が同じ URL に収束することが、この helper を置いた理由そのもの
  it('生の日本語と percent encode 済みの入力が同じ URL に収束する', () => {
    const raw = canonicalUrl('/tags/評価指標').toString();
    const encoded = canonicalUrl('/tags/%E8%A9%95%E4%BE%A1%E6%8C%87%E6%A8%99').toString();
    assert.equal(raw, encoded);
    assert.equal(raw, `${SITE_ORIGIN}/tags/%E8%A9%95%E4%BE%A1%E6%8C%87%E6%A8%99`);
  });

  it('二重 encode しない（canonical を再度通しても変わらない）', () => {
    const once = canonicalUrl('/tags/評価指標').toString();
    const twice = canonicalUrl(new URL(once).pathname).toString();
    assert.equal(once, twice);
  });

  it('canonical / RSS / sitemap が同じ記事に同じ path を出す', () => {
    const path = articlePath('ai-stat-03');
    assert.equal(canonicalUrl(path).toString(), absoluteSiteUrl(path));
  });
});

describe('xmlEscape: sitemap の整形式を守る', () => {
  // `new URL()` は path の `&` を encode しない。Notion の Slug に文字種の
  // 検査は無いので、`&` を含む slug がそのまま <loc> に入ると sitemap 全体が
  // 整形式でない XML になり、1 記事の問題が全 URL の問題になる
  it('URL に残った & を escape する', () => {
    const url = absoluteSiteUrl(articlePath('ai&stats'));
    assert.match(url, /\/posts\/ai&stats$/, '前提: URL parser は & を残す');
    assert.equal(xmlEscape(url), `${SITE_ORIGIN}/posts/ai&amp;stats`);
  });

  it('XML のメタ文字をすべて escape する', () => {
    assert.equal(xmlEscape(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
  });

  it('& を二重 escape しない順序になっている', () => {
    assert.equal(xmlEscape('a&amp;b'), 'a&amp;amp;b');
  });

  it('通常の URL は変えない', () => {
    const url = absoluteSiteUrl('/tags/%E8%A9%95%E4%BE%A1');
    assert.equal(xmlEscape(url), url);
  });
});
