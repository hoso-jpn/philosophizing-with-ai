import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SERIES_DISPLAY_ORDER,
  getSeriesNavigation,
  getSeriesName,
  getSeriesNumber,
  groupPostsBySeries,
  parseSeriesFromTitle,
  parseSeriesLabel,
} from './series.ts';

describe('parseSeriesLabel', () => {
  it('連番付きラベルからシリーズ名を取り出す', () => {
    assert.equal(parseSeriesLabel('AIと哲学12'), 'AIと哲学');
    assert.equal(parseSeriesLabel('AIと生物学03'), 'AIと生物学');
    assert.equal(parseSeriesLabel('AIと統計学01'), 'AIと統計学');
    assert.equal(parseSeriesLabel('AIと実装01'), 'AIと実装');
  });

  it('未知のシリーズもハードコードなしで判定できる', () => {
    assert.equal(parseSeriesLabel('AIと音楽01'), 'AIと音楽');
    assert.equal(parseSeriesLabel('AIと農業07'), 'AIと農業');
    assert.equal(parseSeriesLabel('読書ノート02'), '読書ノート');
  });

  it('全角数字・空白の揺れを吸収する', () => {
    assert.equal(parseSeriesLabel('AIと実装０１'), 'AIと実装');
    assert.equal(parseSeriesLabel('  AIと実装 01  '), 'AIと実装');
  });

  it('連番のない文字列はシリーズとみなさない', () => {
    assert.equal(parseSeriesLabel('AIと哲学'), null);
    assert.equal(parseSeriesLabel('2026年の記録'), null);
    assert.equal(parseSeriesLabel('GPT-5を試した2026'), null);
    assert.equal(parseSeriesLabel(''), null);
    assert.equal(parseSeriesLabel(undefined), null);
  });
});

describe('getSeriesNumber', () => {
  it('半角・全角の連番を数値として読む', () => {
    assert.equal(getSeriesNumber({ titlePrefix: 'AIと統計学03' }), 3);
    assert.equal(getSeriesNumber({ titlePrefix: 'AIと統計学０３' }), 3);
  });

  it('明示 series と異なるラベルの番号を混ぜない', () => {
    assert.equal(getSeriesNumber({ series: 'AIと統計学', titlePrefix: 'AIと哲学03' }), null);
  });
});

describe('getSeriesNavigation', () => {
  const posts = [
    { slug: '03', title: 'AIと統計学03；C', titlePrefix: 'AIと統計学03', date: '2026-01-01' },
    { slug: '01', title: 'AIと統計学01；A', titlePrefix: 'AIと統計学01', date: '2026-03-01' },
    { slug: '02', title: 'AIと統計学02；B', titlePrefix: 'AIと統計学02', date: '2026-02-01' },
  ];

  it('01 は next 02 だけを返す', () => {
    const navigation = getSeriesNavigation(posts[1], posts);
    assert.equal(navigation?.previous, null);
    assert.equal(navigation?.next?.slug, '02');
  });

  it('02 は prev 01 / next 03 を返す', () => {
    const navigation = getSeriesNavigation(posts[2], posts);
    assert.equal(navigation?.previous?.slug, '01');
    assert.equal(navigation?.next?.slug, '03');
  });

  it('03 は prev 02 だけを返す', () => {
    const navigation = getSeriesNavigation(posts[0], posts);
    assert.equal(navigation?.previous?.slug, '02');
    assert.equal(navigation?.next, null);
  });

  it('Date が逆順でも連番を優先し、全角数字も扱う', () => {
    const fullWidth = posts.map((post) => ({ ...post, titlePrefix: post.titlePrefix.replace(/03$/, '０３') }));
    assert.equal(getSeriesNavigation(fullWidth[0], fullWidth)?.previous?.slug, '02');
  });

  it('番号無しは番号付きの後で Date → title → slug の順に安定化する', () => {
    const unnumbered = [
      ...posts,
      { slug: 'appendix-b', title: '補遺B', titlePrefix: '', series: 'AIと統計学', date: '2026-04-01' },
      { slug: 'appendix-a', title: '補遺A', titlePrefix: '', series: 'AIと統計学', date: '2026-04-01' },
    ];
    const navigation = getSeriesNavigation(unnumbered[0], unnumbered);
    assert.equal(navigation?.next?.slug, 'appendix-a');
  });

  it('未知シリーズにも適用し、非シリーズ記事には表示しない', () => {
    const unknown = [
      { slug: 'music-1', title: 'AIと音楽01；A', titlePrefix: 'AIと音楽01' },
      { slug: 'music-2', title: 'AIと音楽02；B', titlePrefix: 'AIと音楽02' },
    ];
    assert.equal(getSeriesNavigation(unknown[0], unknown)?.next?.slug, 'music-2');
    assert.equal(getSeriesNavigation({ slug: 'note', title: '単発記事', titlePrefix: '' }, unknown), null);
  });
});

describe('parseSeriesFromTitle', () => {
  it('区切り文字より前の部分からシリーズ名を取り出す', () => {
    assert.equal(parseSeriesFromTitle('AIと哲学12；AIに仕事を奪われることは、本当に悪いことなのか'), 'AIと哲学');
    assert.equal(parseSeriesFromTitle('AIと生物学03；死が知能を洗練させる'), 'AIと生物学');
    assert.equal(parseSeriesFromTitle('AIと統計学01；データは真実を語るか？'), 'AIと統計学');
    assert.equal(
      parseSeriesFromTitle('AIと実装01；RTX 5090一枚で125B級MoEはどこまで動く？'),
      'AIと実装',
    );
  });

  it('区切り文字の揺れ（；;：:）に対応する', () => {
    assert.equal(parseSeriesFromTitle('AIと実装01;本文'), 'AIと実装');
    assert.equal(parseSeriesFromTitle('AIと実装01：本文'), 'AIと実装');
    assert.equal(parseSeriesFromTitle('AIと実装01:本文'), 'AIと実装');
  });

  it('通常の記事タイトルはシリーズとみなさない', () => {
    assert.equal(parseSeriesFromTitle('あなたの人生は決まっていたのか'), null);
    assert.equal(parseSeriesFromTitle('お知らせ：サイトを移転しました'), null);
    assert.equal(parseSeriesFromTitle('2026年の振り返り：今年読んだ本'), null);
    assert.equal(parseSeriesFromTitle(''), null);
  });
});

describe('getSeriesName', () => {
  it('明示的な series プロパティを最優先する', () => {
    assert.equal(
      getSeriesName({ series: 'AIと実装', titlePrefix: 'AIと哲学01', title: 'AIと哲学01；本文' }),
      'AIと実装',
    );
  });

  it('series が無ければ titlePrefix（Notion の「名前」）を使う', () => {
    assert.equal(getSeriesName({ titlePrefix: 'AIと実装01', title: 'AIと実装01；本文' }), 'AIと実装');
  });

  it('titlePrefix も無ければタイトルから推定する', () => {
    assert.equal(getSeriesName({ title: 'AIと実装01；本文' }), 'AIと実装');
  });

  it('シリーズに属さない記事は null', () => {
    assert.equal(getSeriesName({ title: '雑記' }), null);
    assert.equal(getSeriesName({}), null);
  });
});

describe('groupPostsBySeries', () => {
  const posts = [
    { title: 'AIと哲学01；A', titlePrefix: 'AIと哲学01' },
    { title: 'AIと統計学01；B', titlePrefix: 'AIと統計学01' },
    { title: 'AIと生物学01；C', titlePrefix: 'AIと生物学01' },
    { title: 'AIと哲学02；D', titlePrefix: 'AIと哲学02' },
    { title: 'AIと実装01；E', titlePrefix: 'AIと実装01' },
    { title: '単発の記事', titlePrefix: '' },
  ];

  it('既知シリーズを規定の順序で返す', () => {
    const grouped = groupPostsBySeries(posts);
    assert.deepEqual(
      grouped.map((g) => g.name),
      ['AIと哲学', 'AIと生物学', 'AIと統計学', 'AIと実装'],
    );
  });

  it('シリーズ内の記事順（＝渡された配列の順序）を維持する', () => {
    const grouped = groupPostsBySeries(posts);
    const philosophy = grouped.find((g) => g.name === 'AIと哲学');
    assert.deepEqual(philosophy?.posts.map((p) => p.title), ['AIと哲学01；A', 'AIと哲学02；D']);
  });

  it('シリーズに属さない記事は含めない', () => {
    const grouped = groupPostsBySeries(posts);
    assert.equal(grouped.flatMap((g) => g.posts).length, posts.length - 1);
  });

  it('未知のシリーズは既知シリーズの後ろに初出順で並ぶ', () => {
    const grouped = groupPostsBySeries([
      { titlePrefix: 'AIと音楽01' },
      { titlePrefix: 'AIと哲学01' },
      { titlePrefix: 'AIと農業01' },
      { titlePrefix: 'AIと音楽02' },
    ]);
    assert.deepEqual(
      grouped.map((g) => g.name),
      ['AIと哲学', 'AIと音楽', 'AIと農業'],
    );
    assert.equal(grouped.find((g) => g.name === 'AIと音楽')?.posts.length, 2);
  });

  it('記事が無いシリーズは出力されない', () => {
    const grouped = groupPostsBySeries([{ titlePrefix: 'AIと哲学01' }]);
    assert.deepEqual(grouped.map((g) => g.name), ['AIと哲学']);
    assert.ok(SERIES_DISPLAY_ORDER.includes('AIと実装'));
  });
});
