import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertNoSelfReferencingUrls,
  countReferencedHosts,
  findSelfReferencingUrls,
  formatReferencedHosts,
  isSelfHost,
} from './content-links.ts';

describe('isSelfHost', () => {
  it('現行・旧ドメインを自サイトとみなす', () => {
    assert.ok(isSelfHost('blog.florigen.ai'));
    assert.ok(isSelfHost('philosophizing-with-ai.com'));
  });

  it('vercel.app はサフィックスで判定する（プレビューのホストは毎回変わる）', () => {
    assert.ok(isSelfHost('philosophizing-with-ai.vercel.app'));
    assert.ok(isSelfHost('philosophizing-with-ai-git-refactor-p-bb982a-hoso-jpns-projects.vercel.app'));
  });

  it('大文字小文字を区別しない', () => {
    assert.ok(isSelfHost('BLOG.Florigen.AI'));
  });

  it('引用先の学術サイトなどは対象外', () => {
    for (const host of [
      'www.youtube.com',
      'academic.oup.com',
      'www.sciencedirect.com',
      'www.science.org',
      'www.jmlr.org',
      'www.tandfonline.com',
      'www.cell.com',
    ]) {
      assert.equal(isSelfHost(host), false, host);
    }
  });

  it('似ているが別のホストは対象外', () => {
    assert.equal(isSelfHost('florigen.ai'), false);
    assert.equal(isSelfHost('notphilosophizing-with-ai.com'), false);
  });
});

describe('findSelfReferencingUrls', () => {
  it('取りこぼした実例（旧プレビューホストへのリンク）を捕まえる', () => {
    const content =
      '<a href="https://philosophizing-with-ai.vercel.app/posts/302d3f39-acba-8137-a76f-d74390ed3bad/">前回のAIとの対話</a>';
    const found = findSelfReferencingUrls(content);
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'link');
    assert.equal(found[0].host, 'philosophizing-with-ai.vercel.app');
  });

  it('現行ドメインへの絶対 URL も捕まえる', () => {
    const found = findSelfReferencingUrls('<a href="https://blog.florigen.ai/posts/x">x</a>');
    assert.equal(found.length, 1);
    assert.equal(found[0].host, 'blog.florigen.ai');
  });

  it('<img src> も対象', () => {
    const found = findSelfReferencingUrls(
      '<img src="https://philosophizing-with-ai.com/wp-content/uploads/a.jpg"/>',
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'image');
  });

  it('相対パス・外部サイト・data: は対象外', () => {
    assert.deepEqual(findSelfReferencingUrls('<a href="/posts/determinism-free-will-ai">x</a>'), []);
    assert.deepEqual(findSelfReferencingUrls('<img src="/images/fig1.png"/>'), []);
    assert.deepEqual(findSelfReferencingUrls('<a href="https://www.youtube.com/watch?v=x">動画</a>'), []);
    assert.deepEqual(findSelfReferencingUrls('<img src="data:image/png;base64,iVBORw0KGgo="/>'), []);
  });

  it('リンクと画像が混在していても両方拾う', () => {
    const found = findSelfReferencingUrls(
      '<a href="https://blog.florigen.ai/a">x</a><img src="https://philosophizing-with-ai.com/b.jpg"/>',
    );
    assert.deepEqual(found.map((r) => r.kind).sort(), ['image', 'link']);
  });
});

describe('assertNoSelfReferencingUrls', () => {
  it('相対パスだけなら通す', () => {
    assert.doesNotThrow(() =>
      assertNoSelfReferencingUrls([
        { slug: 'a', content: '<a href="/posts/other">別の記事</a><img src="/images/f.png"/>' },
      ]),
    );
  });

  it('自サイトへの絶対 URL があれば止める', () => {
    assert.throws(
      () =>
        assertNoSelfReferencingUrls([
          { slug: 'a', content: '<a href="https://blog.florigen.ai/posts/x">x</a>' },
        ]),
      /自サイトへの絶対 URL/,
    );
  });

  it('記事名・該当タグ・直し方がエラーに出る', () => {
    try {
      assertNoSelfReferencingUrls([
        { slug: 'ok-post', content: '<a href="/posts/x">問題なし</a>' },
        {
          slug: 'ai-hard-problem-functionalism',
          content:
            '<a href="https://philosophizing-with-ai.vercel.app/posts/302d3f39-acba-8137-a76f-d74390ed3bad/">前回のAIとの対話</a>',
        },
      ]);
      assert.fail('例外が投げられなかった');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /\[content\] ai-hard-problem-functionalism: 自サイトへの絶対URLが含まれています/);
      assert.match(message, /philosophizing-with-ai\.vercel\.app/);
      assert.match(message, /相対パス（\/posts\/<slug>）に書き換えてください/);
      assert.doesNotMatch(message, /ok-post/);
    }
  });

  it('画像には public/images/ 方式を案内する', () => {
    try {
      assertNoSelfReferencingUrls([
        { slug: 'a', content: '<img src="https://philosophizing-with-ai.com/wp-content/uploads/a.jpg"/>' },
      ]);
      assert.fail('例外が投げられなかった');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /public\/images\//);
      // 停止済みホストなら復元できないことも伝える
      assert.match(message, /停止済みで、画像は復元できません/);
    }
  });

  it('全記事をまとめて挙げる（1 件ずつ落とさない）', () => {
    try {
      assertNoSelfReferencingUrls([
        { slug: 'post-a', content: '<a href="https://blog.florigen.ai/a">x</a>' },
        { slug: 'post-b', content: '<a href="https://philosophizing-with-ai.com/b/">y</a>' },
      ]);
      assert.fail('例外が投げられなかった');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /2 記事・計 2 箇所/);
      assert.match(message, /post-a/);
      assert.match(message, /post-b/);
    }
  });
});

describe('countReferencedHosts / formatReferencedHosts', () => {
  it('タグの種類を問わず全 URL のホストを数える', () => {
    const counts = countReferencedHosts([
      { content: '<a href="https://www.youtube.com/watch?v=1">a</a>' },
      { content: '<a href="https://www.youtube.com/watch?v=2">b</a> 参考: https://academic.oup.com/x' },
      { content: '<img src="https://www.cell.com/fig.png"/>' },
    ]);
    assert.equal(counts.get('www.youtube.com'), 2);
    assert.equal(counts.get('academic.oup.com'), 1);
    assert.equal(counts.get('www.cell.com'), 1);
  });

  it('地の文に書かれた URL も拾う（禁止リストは漏れるが一覧は漏れない）', () => {
    const counts = countReferencedHosts([{ content: '詳しくは https://example.com/a を参照' }]);
    assert.equal(counts.get('example.com'), 1);
  });

  it('相対パスは数えない', () => {
    assert.equal(countReferencedHosts([{ content: '<a href="/posts/x">x</a>' }]).size, 0);
  });

  it('件数の多い順、同数ならホスト名順に並べる', () => {
    const counts = new Map([
      ['b.example', 1],
      ['a.example', 1],
      ['many.example', 4],
    ]);
    assert.deepEqual(formatReferencedHosts(counts), [
      '    4  many.example',
      '    1  a.example',
      '    1  b.example',
    ]);
  });
});
