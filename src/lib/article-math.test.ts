import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ArticleMathRenderError, ArticleMathTrustError, renderArticleMath } from './article-math.ts';

describe('renderArticleMath: KaTeX SSR', () => {
  it('inline equation を HTML + MathML にする', () => {
    const html = renderArticleMath('x^2 + y^2', { displayMode: false });

    assert.match(html, /class="katex"/);
    assert.match(html, /<math/);
    assert.doesNotMatch(html, /katex-display/);
  });

  it('display equation を display wrapper 付きで描く', () => {
    const html = renderArticleMath(
      String.raw`Y_{ge} = \mu + G_g + E_e + \sum_k \lambda_k \gamma_{gk}\delta_{ek} + \varepsilon_{ge}`,
      { displayMode: true },
    );

    assert.match(html, /class="katex-display"/);
    assert.match(html, /<math[^>]*display="block"/);
  });

  it('TeX 内の HTML らしい文字列を生の要素として出さない', () => {
    const html = renderArticleMath(String.raw`\text{<script>alert(1)</script>}`, {
      displayMode: false,
    });

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;/);
  });

  it('invalid TeX は fallback 表示せず、記事とブロックを示して失敗する', () => {
    assert.throws(
      () =>
        renderArticleMath(String.raw`\frac{1`, {
          displayMode: true,
          slug: 'allrounder-or-master-gxe-selection',
          blockId: 'eq-ammi',
        }),
      (error: Error) =>
        error instanceof ArticleMathRenderError &&
        error.message.includes('allrounder-or-master-gxe-selection') &&
        error.message.includes('eq-ammi') &&
        error.message.includes('display equation'),
    );
  });

  it('空の式も公開しない', () => {
    assert.throws(
      () => renderArticleMath('  ', { displayMode: false }),
      ArticleMathRenderError,
    );
  });

  // KaTeX の trust 機能を要求するコマンドは、**例外にならず赤字で描かれる**。
  // throwOnError は ParseError にしか効かないので、ここを塞がないと
  // 記事に赤い `\href` の文字だけが公開される（実測）
  for (const command of ['\\href{https://example.invalid}{x}', '\\url{https://example.invalid}', '\\includegraphics{x.png}']) {
    it(`trust を要求する ${command.slice(0, 16)} を赤字 fallback にせず落とす`, () => {
      assert.throws(
        () => renderArticleMath(command, { displayMode: false, slug: 's', blockId: 'b' }),
        (error: Error) =>
          error instanceof ArticleMathRenderError &&
          error.cause instanceof ArticleMathTrustError &&
          error.message.includes('trust'),
      );
    });
  }

  it('trust 拒否の出力を公開しない（リンク要素も赤字 fallback も残さない）', () => {
    // 万一 renderArticleMath が通ってしまった場合に何が出るのかを固定しておく。
    // 現在は throw するので、この test は throw することだけを確かめる
    assert.throws(
      () => renderArticleMath(String.raw`\href{javascript:alert(1)}{x}`, { displayMode: false }),
      ArticleMathRenderError,
    );
  });

  it('数式モードの素の日本語には \\text{} を使うよう案内する', () => {
    assert.throws(
      () => renderArticleMath('面積', { displayMode: false, slug: 's' }),
      (error: Error) => error instanceof ArticleMathRenderError && error.message.includes('\\text{'),
    );
  });

  it('\\text{} で囲んだ日本語は通す', () => {
    const html = renderArticleMath(String.raw`x_{\text{合計}}`, { displayMode: false });
    assert.match(html, /class="katex"/);
  });
});
