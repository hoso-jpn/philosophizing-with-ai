import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NotionSchemaError, parsePost, type ParseWarning } from './notion-schema.ts';

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
