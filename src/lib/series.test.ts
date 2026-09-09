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

  // 現行データでは 4 シリーズ中 2 つが 1 記事だけ。ここで prev/next が
  // 出ると、記事末尾に行き先の無い nav が並ぶ
  it('1 記事だけのシリーズは prev も next も持たない', () => {
    const solo = [{ slug: 'only', title: 'AIと実装01；A', titlePrefix: 'AIと実装01', date: '2026-01-01' }];
    const navigation = getSeriesNavigation(solo[0], solo);
    assert.equal(navigation?.seriesName, 'AIと実装');
    assert.equal(navigation?.previous, null);
    assert.equal(navigation?.next, null);
  });

  it('別シリーズへ越境しない', () => {
    // **別シリーズの連番を意図的に食い違わせる。** 端どうしを並べただけの
    // データだと、シリーズの絞り込みを丸ごと外しても偶然 prev/next が
    // 変わらず、この test が退行を検出できない（実測）。
    // 哲学01 が統計学01と同じ番号・その間の日付を持つので、絞り込みが外れると
    // 統計学01 の next が哲学01 になる。
    const mixed = [
      { slug: 'st-1', title: 'AIと統計学01；A', titlePrefix: 'AIと統計学01', date: '2026-01-01' },
      { slug: 'st-2', title: 'AIと統計学02；B', titlePrefix: 'AIと統計学02', date: '2026-01-09' },
      { slug: 'ph-1', title: 'AIと哲学01；X', titlePrefix: 'AIと哲学01', date: '2026-01-05' },
      { slug: 'ph-2', title: 'AIと哲学02；Y', titlePrefix: 'AIと哲学02', date: '2026-01-07' },
    ];
    const navigationOf = (slug: string) =>
      getSeriesNavigation(mixed.find((post) => post.slug === slug)!, mixed);

    // 同じ番号・間の日付を持つ別シリーズが隣に来ない
    assert.equal(navigationOf('st-1')?.next?.slug, 'st-2');
    assert.equal(navigationOf('st-2')?.previous?.slug, 'st-1');
    assert.equal(navigationOf('ph-1')?.next?.slug, 'ph-2');
    assert.equal(navigationOf('ph-2')?.previous?.slug, 'ph-1');
    // 各シリーズの端は、もう一方のシリーズへ繋がらない
    assert.equal(navigationOf('st-1')?.previous, null);
    assert.equal(navigationOf('st-2')?.next, null);
    assert.equal(navigationOf('ph-1')?.previous, null);
    assert.equal(navigationOf('ph-2')?.next, null);
    // 自分自身を prev/next にしない
    for (const post of mixed) {
      const navigation = getSeriesNavigation(post, mixed);
      assert.notEqual(navigation?.previous?.slug, post.slug);
      assert.notEqual(navigation?.next?.slug, post.slug);
    }
  });

  it('連番が重複しても順序が決まり、入力順に依存しない', () => {
    const duplicated = [
      { slug: 'b', title: 'AIと統計学01；B', titlePrefix: 'AIと統計学01', date: '2026-01-02' },
      { slug: 'a', title: 'AIと統計学01；A', titlePrefix: 'AIと統計学01', date: '2026-01-01' },
      { slug: 'c', title: 'AIと統計学02；C', titlePrefix: 'AIと統計学02', date: '2026-01-03' },
    ];
    const chain = (input: typeof duplicated) => {
      const head = input.find((post) => getSeriesNavigation(post, input)?.previous === null);
      const order: string[] = [];
      let current = head ?? null;
      while (current) {
        order.push(current.slug);
        const next = getSeriesNavigation(current, input)?.next ?? null;
        current = next ? input.find((post) => post.slug === next.slug) ?? null : null;
      }
      return order.join(',');
    };
    assert.equal(chain(duplicated), 'a,b,c');
    assert.equal(chain([...duplicated].reverse()), 'a,b,c');
  });

  it('渡された posts 配列を並べ替えない', () => {
    const input = [...posts];
    const before = input.map((post) => post.slug).join(',');
    getSeriesNavigation(input[0], input);
    assert.equal(input.map((post) => post.slug).join(','), before);
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
