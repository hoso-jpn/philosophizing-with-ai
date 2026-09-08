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
});
