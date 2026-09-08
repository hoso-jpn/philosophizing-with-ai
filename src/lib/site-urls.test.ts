import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  absoluteSiteUrl,
  articlePath,
  canonicalUrl,
  RSS_PATH,
  SITEMAP_PATH,
  SITE_ORIGIN,
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
});
