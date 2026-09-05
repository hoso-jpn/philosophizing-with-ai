import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NotionSchemaError,
  codeSpan,
  markdown,
  parsePost,
  type ParseWarning,
} from './notion-schema.ts';

const rt = (text: string) => ({ rich_text: text ? [{ plain_text: text }] : [] });

function page(overrides: Record<string, unknown> = {}, id = 'page-1') {
  return {
    id,
    properties: {
      '名前': { title: [{ plain_text: 'AIと実装01' }] },
      Title: rt('RTX 5090 で動かす'),
      Slug: rt('rtx-5090'),
      Date: { date: { start: '2026-09-03' } },
      Published: { checkbox: true },
      Content: rt('<!-- wp:paragraph --><p>本文</p>'),
      Tags: rt('LLM、GPU MoE'),
      Description: rt('概要です'),
      HeroImage: { files: [{ file: { url: 'https://example.com/a.png' } }] },
      ...overrides,
    },
  };
}

describe('parsePost: 正常系', () => {
  it('Notion のページを Post に正規化する', () => {
    const post = parsePost(page());
    assert.equal(post.id, 'page-1');
    assert.equal(post.title, 'AIと実装01；RTX 5090 で動かす');
    assert.equal(post.titlePrefix, 'AIと実装01');
    assert.equal(post.titleBody, 'RTX 5090 で動かす');
    assert.equal(post.slug, 'rtx-5090');
    assert.equal(post.date, '2026-09-03');
    assert.equal(post.description, '概要です');
    assert.equal(post.heroImage, 'https://example.com/a.png');
    assert.equal(post.published, true);
  });

  it('タグを既存と同じ区切り（読点・カンマ・空白）で分割する', () => {
    assert.deepEqual(parsePost(page()).tags, ['LLM', 'GPU', 'MoE']);
  });

  it('multi_select 形式の Tags も受け付ける', () => {
    const post = parsePost(page({ Tags: { multi_select: [{ name: 'LLM' }, { name: 'GPU' }] } }));
    assert.deepEqual(post.tags, ['LLM', 'GPU']);
  });

  it('「名前」だけ・Title だけでもタイトルを組み立てる', () => {
    assert.equal(parsePost(page({ Title: rt('') })).title, 'AIと実装01');
    assert.equal(parsePost(page({ '名前': { title: [] } })).title, 'RTX 5090 で動かす');
  });

  it('外部URLのアイキャッチも読める', () => {
    const post = parsePost(page({ HeroImage: { files: [{ external: { url: 'https://x/y.png' } }] } }));
    assert.equal(post.heroImage, 'https://x/y.png');
  });

  it('rich_text が 25 断片以上でも本文として受け付ける', () => {
    const many = { rich_text: Array.from({ length: 30 }, (_, i) => ({ plain_text: `断片${i}` })) };
    const post = parsePost(page({ Content: many }));
    assert.match(post.content, /断片0/);
    assert.match(post.content, /断片29/);
  });
});

describe('parsePost: 必須が欠けたら例外（静かに空文字にしない）', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['プロパティ名が変わって Title が消えた', { Title: undefined }],
    ['プロパティ名が変わって Slug が消えた', { Slug: undefined }],
    ['Slug が空', { Slug: rt('') }],
    ['Date が未設定', { Date: { date: null } }],
    ['名前と Title の両方が空', { '名前': { title: [] }, Title: rt('') }],
    ['本文が空', { Content: rt('') }],
    ['Published の型が違う', { Published: { checkbox: 'true' } }],
  ];

  for (const [label, override] of cases) {
    it(label, () => {
      assert.throws(() => parsePost(page(override)), NotionSchemaError);
    });
  }

  it('エラーメッセージにページ ID と原因が入る', () => {
    assert.throws(
      () => parsePost(page({ Slug: undefined }, 'page-xyz')),
      (e: Error) => e.message.includes('page-xyz') && e.message.includes('Slug'),
    );
  });
});

describe('parsePost: 任意項目は警告に留める', () => {
  it('Description が空でも失敗せず警告を積む', () => {
    const warnings: ParseWarning[] = [];
    const post = parsePost(page({ Description: rt('') }), warnings);
    assert.equal(post.description, '');
    assert.deepEqual(warnings, [{ slug: 'rtx-5090', message: 'Description が空です' }]);
  });

  it('Description プロパティ自体が無くても失敗しない', () => {
    const warnings: ParseWarning[] = [];
    assert.equal(parsePost(page({ Description: undefined }), warnings).description, '');
    assert.equal(warnings.length, 1);
  });

  it('Tags が空なら警告する', () => {
    const warnings: ParseWarning[] = [];
    assert.deepEqual(parsePost(page({ Tags: rt('') }), warnings).tags, []);
    assert.ok(warnings.some((w) => w.message.includes('Tags')));
  });

  it('HeroImage が無くても失敗しない', () => {
    const post = parsePost(page({ HeroImage: undefined }));
    assert.equal(post.heroImage, null);
  });

  it('スキーマが知らないプロパティが増えても壊れない', () => {
    // Notion 側で列を足しても（Phase 4 の Format など）ビルドは通る。
    // 逆に列を消しても、必須でなければ通る（Status 列の削除がこれに当たる）。
    const post = parsePost(page({ 未知の列: rt('なにか') }));
    assert.equal(post.slug, 'rtx-5090');
  });
});

describe('parsePost: Content の必須性は本文 source によって変わる', () => {
  /** 本文をページ本文へ移した記事だけ true を返す判定 */
  const migrated = (slug: string) => slug === 'rtx-5090';

  it('legacy 記事は Content が必須（プロパティごと消えたら例外）', () => {
    assert.throws(() => parsePost(page({ Content: undefined })), NotionSchemaError);
  });

  it('legacy 記事は Content が空でも例外（従来どおり）', () => {
    assert.throws(() => parsePost(page({ Content: rt('') })), NotionSchemaError);
    assert.throws(() => parsePost(page({ Content: rt('   ') })), NotionSchemaError);
  });

  it('page-body 記事は Content が無くても parse できる', () => {
    const post = parsePost(page({ Content: undefined }), [], migrated);
    assert.equal(post.slug, 'rtx-5090');
    assert.equal(post.content, '');
    assert.equal(post.title, 'AIと実装01；RTX 5090 で動かす');
  });

  it('page-body 記事は Content が空でも parse できる', () => {
    assert.equal(parsePost(page({ Content: rt('') }), [], migrated).content, '');
  });

  it('page-body 記事でも Content が残っていればそのまま読む（fallback 用）', () => {
    assert.equal(parsePost(page(), [], migrated).content, '<!-- wp:paragraph --><p>本文</p>');
  });

  it('allowlist に無い slug は移行対象外として扱う', () => {
    const other = page({ Slug: rt('other-post'), Content: rt('') });
    assert.throws(() => parsePost(other, [], migrated), NotionSchemaError);
  });

  it('Content プロパティが無い場合のエラー文は allowlist を案内する', () => {
    assert.throws(
      () => parsePost(page({ Content: undefined })),
      (e: Error) => e.message.includes('migration-allowlist'),
    );
  });

  it('既定の判定では全記事が legacy 扱い（allowlist が空のため）', () => {
    assert.throws(() => parsePost(page({ Content: rt('') })), NotionSchemaError);
  });
});

const ann = (overrides: Record<string, boolean> = {}) => ({
  bold: false, italic: false, strikethrough: false, underline: false, code: false,
  color: 'default', ...overrides,
});
const frag = (plain_text: string, annotations?: unknown, href?: string | null) =>
  ({ plain_text, annotations, href }) as never;

describe('markdown: Notion の装飾を marked へ渡せる形に戻す', () => {
  it('装飾も href も無いフラグメントは 1 バイトも変えない', () => {
    // 既存の Gutenberg HTML 記事はすべてこの形。文字列が変わると本文が壊れる
    const gutenberg = '<!-- wp:paragraph -->\n<p>本文です。</p>\n<!-- /wp:paragraph -->';
    assert.equal(markdown([frag(gutenberg)]), gutenberg);
    assert.equal(markdown([frag('a * b _c_ [d](e) `f` ~g~')]), 'a * b _c_ [d](e) `f` ~g~');
  });

  it('装飾を HTML タグで復元する', () => {
    assert.equal(markdown([frag('x', ann({ bold: true }))]), '<strong>x</strong>');
    assert.equal(markdown([frag('x', ann({ italic: true }))]), '<em>x</em>');
    assert.equal(markdown([frag('x', ann({ strikethrough: true }))]), '<del>x</del>');
    assert.equal(markdown([frag('x', ann({ underline: true }))]), '<u>x</u>');
  });

  it('全角約物の直前で強調が閉じられる（Markdown の flanking 規則を回避する）', () => {
    // `行動を**veto（阻止）**する` は CommonMark では閉じられず、リテラルの ** が表示される。
    // 実データで 4 箇所発生していた
    const md = markdown([frag('行動を'), frag('veto（阻止）', ann({ bold: true })), frag('する')]);
    assert.equal(md, '行動を<strong>veto（阻止）</strong>する');
    assert.doesNotMatch(md, /\*\*/);
  });

  it('インラインコードは Markdown のまま残す（HTML にすると中身が再解釈される）', () => {
    assert.equal(markdown([frag('x', ann({ code: true }))]), '`x`');
  });

  it('コード内のバッククォートで壊れない', () => {
    assert.equal(markdown([frag('foo`bar', ann({ code: true }))]), '``foo`bar``');
    assert.equal(markdown([frag('`x`', ann({ code: true }))]), '`` `x` ``');
    assert.equal(markdown([frag('a``b', ann({ code: true }))]), '```a``b```');
  });

  it('リンクは HTML にする（ラベルの ] や URL の ) / 空白で壊れないため）', () => {
    assert.equal(
      markdown([frag('a]b', ann(), 'https://example.com')]),
      '<a href="https://example.com">a]b</a>',
    );
    assert.equal(
      markdown([frag('L', ann(), 'https://example.com/a(b) c')]),
      '<a href="https://example.com/a(b) c">L</a>',
    );
    assert.equal(markdown([frag('L', ann(), '/posts/example')]), '<a href="/posts/example">L</a>');
  });

  it('href が null / 空文字ならリンクにしない', () => {
    assert.equal(markdown([frag('L', ann(), null)]), 'L');
    assert.equal(markdown([frag('L', ann(), '')]), 'L');
  });

  it('装飾フラグメントの HTML 特殊文字をエスケープする', () => {
    assert.equal(markdown([frag('a<b>&c', ann({ bold: true }))]), '<strong>a&lt;b&gt;&amp;c</strong>');
    assert.equal(markdown([frag('L', ann(), 'https://e.com/?a="x"')]).includes('&quot;'), true);
  });

  it('複数の装飾を決まった順序で入れ子にする', () => {
    assert.equal(markdown([frag('x', ann({ bold: true, italic: true }))]), '<em><strong>x</strong></em>');
    assert.equal(
      markdown([frag('x', ann({ code: true }), 'https://example.com')]),
      '<a href="https://example.com">`x`</a>',
    );
    assert.equal(
      markdown([frag('x', ann({ bold: true }), '/posts/example')]),
      '<a href="/posts/example"><strong>x</strong></a>',
    );
  });

  it('装飾あり・なしが混在しても順序と文字列を保つ', () => {
    assert.equal(
      markdown([frag('前'), frag('太', ann({ bold: true })), frag('後')]),
      '前<strong>太</strong>後',
    );
  });
});

describe('codeSpan', () => {
  it('中の最長連続バッククォートより 1 本多い区切りを使う', () => {
    assert.equal(codeSpan('x'), '`x`');
    assert.equal(codeSpan('a`b'), '``a`b``');
    assert.equal(codeSpan('a``b'), '```a``b```');
  });

  it('バッククォートで始まる/終わる場合は空白で詰める', () => {
    assert.equal(codeSpan('`x'), '`` `x ``');
    assert.equal(codeSpan('x`'), '`` x` ``');
  });
});
