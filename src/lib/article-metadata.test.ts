import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { articleDescription } from './article-metadata.ts';
import type { Post } from './types.ts';

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'page-1',
    title: 'AIと哲学01；テスト',
    titlePrefix: 'AIと哲学01',
    titleBody: 'テスト',
    series: null,
    slug: 'test',
    date: '2026-09-08',
    description: '',
    tags: [],
    heroImage: null,
    published: true,
    contentSource: { kind: 'legacy', content: '<!-- wp:paragraph --><p>本文の <strong>要約</strong> です。</p>' },
    ...overrides,
  };
}

describe('articleDescription', () => {
  it('明示された Description を優先し、空白を正規化する', () => {
    assert.equal(articleDescription(post({ description: '  明示された\n概要  ' })), '明示された 概要');
  });

  it('legacy HTML / Markdown から見える文字列を取り出す', () => {
    assert.equal(articleDescription(post()), '本文の 要約 です。');
  });

  it('page-body の rich text から概要を作る', () => {
    const base = post();
    assert.equal(articleDescription({
      ...base,
      contentSource: {
        kind: 'notion-page',
        pageId: 'page-1',
        document: { blocks: [{
          kind: 'paragraph', id: 'p1', richText: [
            { kind: 'text', text: '統計モデル ', bold: false, italic: false, strikethrough: false, underline: false, code: false, href: null },
            { kind: 'equation', expression: 'y = Xb' },
          ],
        }] },
      },
    }), '統計モデル y = Xb');
  });

  it('code point 単位で上限に収める', () => {
    assert.equal(articleDescription(post({ description: '😀'.repeat(10) }), 6), '😀😀😀😀😀…');
  });

  it('サロゲートペアを途中で割らない（孤立サロゲートを出さない）', () => {
    const value = articleDescription(post({ description: '👨‍👩‍👧‍👦'.repeat(60) }));
    assert.equal([...value].length, 160);
    // 孤立サロゲートが 1 つでも残れば well-formed ではなくなる
    assert.ok(value.isWellFormed(), '孤立サロゲートが残っています');
  });

  // description は公開の meta タグになる。legacy 本文に素の署名付き URL が
  // 残っていると、X-Amz-Signature ごと検索結果へ出てしまう
  it('本文に素で書かれた署名付き URL を description へ出さない', () => {
    const value = articleDescription(post({
      contentSource: {
        kind: 'legacy',
        content: '参照 https://x.s3.amazonaws.com/a.png?X-Amz-Signature=SECRET です',
      },
    }));
    assert.doesNotMatch(value, /SECRET|X-Amz|amazonaws|https?:/);
    assert.equal(value, '参照 です');
  });

  it('page-body 側でも素の URL を description へ出さない', () => {
    const base = post();
    const value = articleDescription({
      ...base,
      contentSource: {
        kind: 'notion-page',
        pageId: 'page-1',
        document: { blocks: [{
          kind: 'paragraph', id: 'p1', richText: [
            { kind: 'text', text: '図は https://x.s3.amazonaws.com/a.png?X-Amz-Signature=SECRET にあります', bold: false, italic: false, strikethrough: false, underline: false, code: false, href: null },
          ],
        }] },
      },
    });
    assert.doesNotMatch(value, /SECRET|X-Amz|https?:/);
  });

  // 実体参照を戻してからタグを落とす。逆順だと &lt;script&gt; がタグ除去を
  // 素通りしてから < > に戻り、markup が description に残る
  it('escape された markup を description へ残さない', () => {
    const value = articleDescription(post({
      contentSource: { kind: 'legacy', content: '<p>段落</p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; x' },
    }));
    assert.doesNotMatch(value, /[<>]/);
    assert.equal(value, '段落 alert(1) & x');
  });

  it('& を二重デコードしない', () => {
    assert.equal(
      articleDescription(post({ contentSource: { kind: 'legacy', content: 'A &amp;lt; B' } })),
      'A &lt; B',
    );
  });

  // 数式・コードだけの記事で、TeX やコードを抜粋にせずタイトルへ落とす
  it('本文から文字を取れない記事はタイトルへ落とす', () => {
    const base = post();
    for (const blocks of [
      [{ kind: 'equation' as const, id: 'e', expression: 'y_{ij}=\\mu' }],
      [{ kind: 'code' as const, id: 'c', code: 'print(1)', language: 'py', caption: [] }],
      [],
    ]) {
      assert.equal(
        articleDescription({
          ...base,
          contentSource: { kind: 'notion-page', pageId: 'page-1', document: { blocks } },
        }),
        base.title,
      );
    }
  });
});
