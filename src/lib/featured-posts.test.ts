import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FEATURED_POST_SELECTIONS,
  resolveFeaturedPosts,
  type FeaturedPostSelection,
  type FeaturedPostSource,
} from './featured-posts.ts';

const post = (slug: string, title: string, date = '2026-01-01'): FeaturedPostSource => ({
  slug,
  title,
  titlePrefix: title.split(/[；;：:]/)[0],
  date,
});

const published: FeaturedPostSource[] = [
  post('philosophy-01', 'AIと哲学01；決定論と自由意志', '2025-12-10'),
  post('statistics-01', 'AIと統計学01；データは真実を語るか', '2025-12-11'),
  post('biology-03', 'AIと生物学03；死は知能を洗練させるのか', '2025-12-19'),
  post('implementation-01', 'AIと実装01；ローカルLLMを動かす', '2026-09-03'),
];

describe('resolveFeaturedPosts', () => {
  it('選定設定の順序をそのまま表示順にする', () => {
    const selections: FeaturedPostSelection[] = [
      { slug: 'implementation-01', summary: '実装' },
      { slug: 'philosophy-01', summary: '哲学' },
      { slug: 'statistics-01', summary: '統計' },
    ];

    const { posts, warnings } = resolveFeaturedPosts(published, selections);

    assert.deepEqual(
      posts.map((p) => p.slug),
      ['implementation-01', 'philosophy-01', 'statistics-01'],
    );
    assert.deepEqual(warnings, []);
  });

  it('公開日順・タイトル順ではなく、設定順で決まる（並べ替えを持ち込まない）', () => {
    const selections: FeaturedPostSelection[] = [
      { slug: 'biology-03', summary: '生物' },
      { slug: 'philosophy-01', summary: '哲学' },
    ];

    const { posts } = resolveFeaturedPosts(published, selections);

    // 公開日昇順なら philosophy-01 が先に来る。設定順が勝つことを確かめる
    assert.deepEqual(
      posts.map((p) => p.slug),
      ['biology-03', 'philosophy-01'],
    );
  });

  it('タイトル・公開日は公開記事側を正とし、リンクは既存の URL ヘルパーが作る', () => {
    const { posts } = resolveFeaturedPosts(published, [
      { slug: 'philosophy-01', summary: '紹介文はここだけが持つ' },
    ]);

    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, 'AIと哲学01；決定論と自由意志');
    assert.equal(posts[0].date, '2025-12-10');
    assert.equal(posts[0].href, '/posts/philosophy-01');
    assert.equal(posts[0].seriesName, 'AIと哲学');
    assert.equal(posts[0].summary, '紹介文はここだけが持つ');
  });

  it('内部リンクは相対パスで、自サイトの絶対 URL を作らない（D-13）', () => {
    const { posts } = resolveFeaturedPosts(published, FEATURED_POST_SELECTIONS.map(
      (selection, index) => ({ ...selection, slug: published[index % published.length].slug }),
    ));

    for (const featured of posts) {
      assert.match(featured.href, /^\/posts\//);
      assert.doesNotMatch(featured.href, /^https?:|^\/\/|^\\\\/);
    }
  });

  it('公開記事一覧に無い slug はリンクにせず、診断可能な警告を出す', () => {
    const { posts, warnings } = resolveFeaturedPosts(published, [
      { slug: 'philosophy-01', summary: '哲学' },
      { slug: 'unpublished-draft', summary: '下書きへ戻した記事' },
      { slug: 'statistics-01', summary: '統計' },
    ]);

    assert.deepEqual(
      posts.map((p) => p.slug),
      ['philosophy-01', 'statistics-01'],
    );
    assert.equal(warnings.length, 1);
    // どの slug が外れたのかが分からない警告は、診断に使えない
    assert.match(warnings[0], /unpublished-draft/);
  });

  it('同じ記事を 2 回指定しても、同じセクション内に重複を出さない', () => {
    const { posts, warnings } = resolveFeaturedPosts(published, [
      { slug: 'philosophy-01', summary: '1 回目' },
      { slug: 'statistics-01', summary: '統計' },
      { slug: 'philosophy-01', summary: '2 回目' },
    ]);

    assert.deepEqual(
      posts.map((p) => p.slug),
      ['philosophy-01', 'statistics-01'],
    );
    assert.equal(posts[0].summary, '1 回目');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /philosophy-01/);
  });

  it('公開記事側に同じ slug が 2 件あっても、代表記事は 1 件しか出ない', () => {
    const duplicated = [...published, post('philosophy-01', '重複した公開記事')];

    const { posts } = resolveFeaturedPosts(duplicated, [{ slug: 'philosophy-01', summary: '哲学' }]);

    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, 'AIと哲学01；決定論と自由意志');
  });

  it('代表記事が 1 件も解決できなくても例外にせず、空で返す（セクションを省略できる）', () => {
    const { posts, warnings } = resolveFeaturedPosts(published, [
      { slug: 'gone-1', summary: 'a' },
      { slug: 'gone-2', summary: 'b' },
    ]);

    assert.deepEqual(posts, []);
    assert.equal(warnings.length, 2);
  });

  it('公開記事が空でも例外にしない（件数の保護は getPosts 側の責務）', () => {
    const { posts, warnings } = resolveFeaturedPosts([], FEATURED_POST_SELECTIONS);

    assert.deepEqual(posts, []);
    assert.equal(warnings.length, FEATURED_POST_SELECTIONS.length);
  });

  it('空の slug を設定に書いた場合も、空リンクを作らず警告にする', () => {
    const { posts, warnings } = resolveFeaturedPosts(published, [{ slug: '   ', summary: 'x' }]);

    assert.deepEqual(posts, []);
    assert.equal(warnings.length, 1);
  });

  it('シリーズに属さない記事も代表記事にできる（seriesName は null）', () => {
    const standalone: FeaturedPostSource = {
      slug: 'standalone',
      title: '連番のない単発記事',
      titlePrefix: '',
      date: '2026-02-02',
    };

    const { posts } = resolveFeaturedPosts([standalone], [{ slug: 'standalone', summary: '単発' }]);

    assert.equal(posts[0].seriesName, null);
  });
});

describe('FEATURED_POST_SELECTIONS', () => {
  it('3〜4 本に収める', () => {
    assert.ok(
      FEATURED_POST_SELECTIONS.length >= 3 && FEATURED_POST_SELECTIONS.length <= 4,
      `代表記事は 3〜4 本（現在 ${FEATURED_POST_SELECTIONS.length} 本）`,
    );
  });

  it('slug が重複していない', () => {
    const slugs = FEATURED_POST_SELECTIONS.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it('各件が slug と紹介文を持つ', () => {
    for (const selection of FEATURED_POST_SELECTIONS) {
      assert.notEqual(selection.slug.trim(), '');
      assert.notEqual(selection.summary.trim(), '');
    }
  });

  it('アクセス数の裏付けが無い表現を使わない', () => {
    for (const { slug, summary } of FEATURED_POST_SELECTIONS) {
      assert.doesNotMatch(summary, /人気|よく読まれ|話題の|ランキング|バズ/, `${slug} の紹介文`);
    }
  });

  it('紹介文にタイトルを二重管理しない（記事タイトルは Notion 側を正とする）', () => {
    for (const { slug, summary } of FEATURED_POST_SELECTIONS) {
      assert.doesNotMatch(summary, /^AIと(哲学|統計学|生物学|実装)\d/, `${slug} の紹介文`);
    }
  });
});
