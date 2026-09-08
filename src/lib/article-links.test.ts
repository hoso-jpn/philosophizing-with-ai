import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ArticleUrlPolicyError,
  assertArticleUrlInvariants,
  findArticleUrlViolations,
} from './article-links.ts';
import { findUrlPolicyViolation, safeHref } from './content-links.ts';
import type { ArticleBlock, ArticleDocument, ArticleRichText } from './article-document.ts';

const link = (href: string): ArticleRichText => ({
  kind: 'text',
  text: 'ラベル',
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  href,
});

const doc = (blocks: ArticleBlock[]): ArticleDocument => ({ blocks });
const withLink = (href: string) => doc([{ kind: 'paragraph', id: 'p1', richText: [link(href)] }]);
const reasonOf = (href: string) => findUrlPolicyViolation(href)?.reason ?? null;

/* --------------------------------------------------------------- URL 規則 */

describe('findUrlPolicyViolation: 本文へ書いてよい URL の形', () => {
  it('外部サイトへの絶対 URL は通す', () => {
    for (const url of [
      'https://doi.org/10.1111/x',
      'http://example.com/a?b=c#d',
      'https://www.science.org/x',
      'mailto:a@example.com',
    ]) {
      assert.equal(reasonOf(url), null, `${url} を弾いた`);
    }
  });

  it('相対パスは通す（内部リンクの正しい書き方）', () => {
    for (const url of ['/posts/example', 'relative/path', '#section', '?q=1', '/images/a.png']) {
      assert.equal(reasonOf(url), null, `${url} を弾いた`);
    }
  });

  it('自サイトへの絶対 URL を止める', () => {
    assert.equal(reasonOf('https://blog.florigen.ai/posts/foo'), 'self-host');
    assert.equal(reasonOf('https://philosophizing-with-ai.com/posts/foo'), 'self-host');
    assert.equal(reasonOf('https://preview-abc.vercel.app/posts/foo'), 'self-host');
  });

  it('Notion の内部リンクを止める（読者が開けない）', () => {
    assert.equal(reasonOf('https://app.notion.com/posts/foo'), 'self-host');
    assert.equal(reasonOf('https://www.notion.so/Page-abc123'), 'self-host');
    assert.equal(reasonOf('https://notion.so/Page-abc123'), 'self-host');
  });

  it('Notion のページ ID を指す相対パスを止める', () => {
    assert.equal(reasonOf('/posts/302d3f39-acba-8137-a76f-d74390ed3bad'), 'notion-id-path');
    assert.equal(reasonOf('/posts/302d3f39acba8137a76fd74390ed3bad'), 'notion-id-path');
  });

  it('protocol-relative URL を相対パス扱いしない', () => {
    // スキームを持たないので素朴に見ると相対だが、ブラウザは別オリジンへ解決する
    assert.equal(reasonOf('//blog.florigen.ai/posts/foo'), 'authority-shorthand');
    assert.equal(reasonOf('//evil.example.com/path'), 'authority-shorthand');
    assert.equal(reasonOf('//www.notion.so/x'), 'authority-shorthand');
  });

  it('バックスラッシュ形も同じく止める', () => {
    assert.equal(reasonOf('\\\\blog.florigen.ai/posts/foo'), 'authority-shorthand');
    assert.equal(reasonOf('\\\\evil.example.com/path'), 'authority-shorthand');
    assert.equal(reasonOf('/\\evil.example.com/path'), 'authority-shorthand');
    assert.equal(reasonOf('\\/evil.example.com/path'), 'authority-shorthand');
  });

  it('ブラウザの解決結果と判定が食い違わない', () => {
    // 「相対パスに見えるが外部へ飛ぶ」形を実際に解決して確かめる
    const base = 'https://blog.florigen.ai/posts/x';
    for (const raw of ['//evil.example.com/p', '\\\\evil.example.com/p']) {
      assert.equal(new URL(raw, base).origin, 'https://evil.example.com');
      assert.equal(reasonOf(raw), 'authority-shorthand', `${raw} を素通しした`);
    }
    // 本物の相対パスは同一オリジンに留まる
    assert.equal(new URL('/posts/y', base).origin, 'https://blog.florigen.ai');
    assert.equal(reasonOf('/posts/y'), null);
  });

  it('空文字・空白は対象外', () => {
    assert.equal(reasonOf(''), null);
    assert.equal(reasonOf('   '), null);
  });
});

/* --------------------------------------------------------- 責務の分離 */

describe('safeHref と URL 規則は責務が違う', () => {
  it('safeHref はスキームの安全性、URL 規則は正規形を見る', () => {
    // javascript: は safeHref が弾く。URL 規則はホストを見るだけで関知しない
    assert.equal(safeHref('javascript:alert(1)'), null);

    // 自サイト絶対 URL は safeHref を通る（危険ではない）が、URL 規則が止める
    assert.equal(safeHref('https://blog.florigen.ai/posts/x'), 'https://blog.florigen.ai/posts/x');
    assert.equal(reasonOf('https://blog.florigen.ai/posts/x'), 'self-host');
  });

  it('XSS 用のスキーム判定は #6 でも維持されている', () => {
    const T = String.fromCharCode(9);
    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      `java${T}script:alert(1)`,
      `java${LF}script:alert(1)`,
      `java${CR}script:alert(1)`,
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/x',
    ]) {
      assert.equal(safeHref(href), null, `${JSON.stringify(href)} を通した`);
    }
  });
});

/* ------------------------------------------------------------ 本文の走査 */

describe('findArticleUrlViolations: 本文を漏れなく辿る', () => {
  it('問題が無ければ空', () => {
    assert.deepEqual(findArticleUrlViolations(withLink('/posts/other')), []);
  });

  it('段落のリンクを見つける', () => {
    const [violation] = findArticleUrlViolations(withLink('https://blog.florigen.ai/posts/x'));
    assert.equal(violation.reason, 'self-host');
    assert.equal(violation.blockId, 'p1');
    assert.equal(violation.origin, 'link');
  });

  it('見出し・引用・callout・リスト項目・入れ子のリンクを見つける', () => {
    const bad = 'https://blog.florigen.ai/posts/x';
    const document = doc([
      { kind: 'heading', id: 'h', level: 2, richText: [link(bad)] },
      { kind: 'quote', id: 'q', richText: [link(bad)], children: [] },
      { kind: 'callout', id: 'c', richText: [], icon: null, children: [{ kind: 'paragraph', id: 'cp', richText: [link(bad)] }] },
      {
        kind: 'list',
        ordered: false,
        items: [
          { id: 'li1', richText: [link(bad)], children: [] },
          {
            id: 'li2',
            richText: [],
            children: [{ kind: 'list', ordered: true, items: [{ id: 'li3', richText: [link(bad)], children: [] }] }],
          },
        ],
      },
    ]);

    assert.deepEqual(
      findArticleUrlViolations(document).map((v) => v.blockId).sort(),
      ['cp', 'h', 'li1', 'li3', 'q'],
    );
  });

  it('code / image の caption と table のセルも辿る', () => {
    const bad = '//evil.example.com/x';
    const document = doc([
      { kind: 'code', id: 'cd', code: 'x', language: null, caption: [link(bad)] },
      {
        kind: 'image',
        id: 'im',
        source: { kind: 'local', src: '/notion-static/a.svg' },
        caption: [link(bad)],
        alt: '図',
      },
      {
        kind: 'table',
        id: 'tb',
        hasColumnHeader: false,
        hasRowHeader: false,
        rows: [{ id: 'r1', cells: [[link(bad)]] }],
      },
    ]);

    // table は描画が #7 待ちだが、URL は今のうちに見ておく
    assert.deepEqual(
      findArticleUrlViolations(document).map((v) => v.blockId).sort(),
      ['cd', 'im', 'r1'],
    );
  });

  it('画像の取得元も検査する（ローカル化前）', () => {
    const document = doc([
      {
        kind: 'image',
        id: 'im',
        source: { kind: 'external', url: 'https://blog.florigen.ai/images/a.png' },
        caption: [],
        alt: null,
      },
    ]);
    const [violation] = findArticleUrlViolations(document);
    assert.equal(violation.origin, 'image');
    assert.equal(violation.reason, 'self-host');
  });

  it('ローカル化済みの画像は対象外', () => {
    const document = doc([
      { kind: 'image', id: 'im', source: { kind: 'local', src: '/notion-static/a.svg' }, caption: [], alt: '図' },
    ]);
    assert.deepEqual(findArticleUrlViolations(document), []);
  });
});

describe('assertArticleUrlInvariants', () => {
  it('違反があれば記事 slug 付きで落ちる', () => {
    assert.throws(
      () => assertArticleUrlInvariants(withLink('https://blog.florigen.ai/posts/x'), { slug: 'ai-stats-03' }),
      (e: Error) =>
        e instanceof ArticleUrlPolicyError &&
        e.message.includes('ai-stats-03') &&
        e.message.includes('p1') &&
        e.message.includes('相対パス'),
    );
  });

  it('複数の違反をまとめて出す（1 件ずつ直させない）', () => {
    const document = doc([
      { kind: 'paragraph', id: 'p1', richText: [link('https://blog.florigen.ai/a')] },
      { kind: 'paragraph', id: 'p2', richText: [link('//evil.example.com/b')] },
      { kind: 'paragraph', id: 'p3', richText: [link('/posts/302d3f39-acba-8137-a76f-d74390ed3bad')] },
    ]);
    assert.throws(
      () => assertArticleUrlInvariants(document, { slug: 's' }),
      (e: Error) => e.message.includes('3 件') && ['p1', 'p2', 'p3'].every((id) => e.message.includes(id)),
    );
  });

  it('正しく書かれた本文は通る', () => {
    assert.doesNotThrow(() =>
      assertArticleUrlInvariants(
        doc([
          { kind: 'paragraph', id: 'p1', richText: [link('/posts/other'), link('https://doi.org/10.1/x')] },
          { kind: 'image', id: 'im', source: { kind: 'local', src: '/notion-static/a.svg' }, caption: [], alt: '図' },
        ]),
        { slug: 's' },
      ),
    );
  });
});
