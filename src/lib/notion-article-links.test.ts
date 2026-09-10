import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertArticleUrlInvariants, resolveNotionArticleLinks } from './article-links.ts';
import type { ArticleDocument, ArticleRichText } from './article-document.ts';

const text = (href: string): ArticleRichText => ({
  kind: 'text', text: '関連記事', href, bold: true, italic: false,
  underline: false, strikethrough: false, code: false,
});
const doc = (href: string): ArticleDocument => ({
  blocks: [{ kind: 'quote', id: 'quote', richText: [], children: [
    { kind: 'paragraph', id: 'p', richText: [text(href)] },
  ] }],
});

describe('Notion が補った記事リンクの origin を復元する', () => {
  it('実在する公開 slug のみ相対化し、本文・注釈・元データを保持する', () => {
    const source = doc('https://app.notion.com/posts/living-by-curiosity?from=article#section');
    const resolved = resolveNotionArticleLinks(source, new Set(['living-by-curiosity']));
    assert.deepEqual(resolved, doc('/posts/living-by-curiosity?from=article#section'));
    assert.equal(JSON.stringify(source).includes('https://app.notion.com'), true);
    assertArticleUrlInvariants(resolved, { slug: 'source' });
  });

  it('typo・非公開 slug・UUID・別 origin・非正規 path は修復せず従来の検査で落とす', () => {
    for (const href of [
      'https://app.notion.com/posts/typo',
      'https://app.notion.com/posts/unpublished',
      'https://app.notion.com/posts/302d3f39acba8137a76fd74390ed3bad',
      'http://app.notion.com/posts/living-by-curiosity',
      'https://blog.florigen.ai/posts/living-by-curiosity',
      'https://www.notion.so/posts/living-by-curiosity',
      'https://app.notion.com/posts/x/../living-by-curiosity',
      'https://app.notion.com/posts/%6civing-by-curiosity',
    ]) {
      const source = doc(href);
      const resolved = resolveNotionArticleLinks(source, new Set(['living-by-curiosity']));
      assert.deepEqual(resolved, source);
      assert.throws(() => assertArticleUrlInvariants(resolved, { slug: 'source' }));
    }
  });

  it('外部リンク・既存相対リンクを変更しない', () => {
    for (const href of ['https://doi.org/10.1234/example', '/posts/living-by-curiosity']) {
      const source = doc(href);
      assert.deepEqual(resolveNotionArticleLinks(source, new Set(['living-by-curiosity'])), source);
    }
  });
});
