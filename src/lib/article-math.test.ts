import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ArticleMathRenderError, renderArticleMath } from './article-math.ts';

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
});
