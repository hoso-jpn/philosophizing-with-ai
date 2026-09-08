import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const distRoot = new URL('../tests/fixture/dist/', import.meta.url);
const html = await readFile(new URL('index.html', distRoot), 'utf-8');

/**
 * 生成 HTML が読み込んでいる **自サイトの** CSS を全部つなげたもの。
 *
 * `rel="stylesheet"` には外部 CDN（BaseHead が読む Google Fonts）も含まれる。
 * それを出力ディレクトリのファイルとして開こうとすると ENOENT で落ちるので、
 * root 相対の href だけを見る。
 */
async function emittedCss() {
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => href.startsWith('/') && !href.startsWith('//'));
  assert.notEqual(hrefs.length, 0, '自サイトの stylesheet が 1 つも出力されていません');
  const sheets = await Promise.all(
    hrefs.map((href) => readFile(new URL(`.${href}`, distRoot), 'utf-8')),
  );
  return sheets.join('\n');
}

/**
 * scoped style が本当に当たるかを見る。
 *
 * Astro の scoped style は「その .astro の template に書かれた要素」にしか
 * scope 属性を付けない。div を子コンポーネントへ切り出して style を親に残すと、
 * HTML は `<div class="x">`、CSS は `.x[data-astro-cid-…]` になり **1 つも
 * 当たらなくなる**。文字列一致だけの assertion はこれを素通しするので、
 * 「その class の要素が持つ scope 属性」と「CSS 側の selector」を突き合わせる。
 */
function assertScopedStyleApplies(css, className, expectedDeclaration) {
  const tag = html.match(new RegExp(`<[a-z]+ class="${className}"[^>]*>`));
  assert.ok(tag, `${className} の要素が出力にありません`);

  const scope = tag[0].match(/data-astro-cid-[a-z0-9]+/);
  assert.ok(
    scope,
    `${className} に scope 属性がありません（style を持つ .astro の外へ要素が移動しています）`,
  );

  const rule = new RegExp(`\\.${className}\\[${scope[0]}\\][^{]*\\{[^}]*${expectedDeclaration}`);
  assert.match(
    css,
    rule,
    `${className}[${scope[0]}] に ${expectedDeclaration} が当たっていません`,
  );
}

assert.match(html, /article-math--inline/, 'inline 数式が描画されていません');
assert.match(html, /article-math--display/, 'display 数式が描画されていません');
assert.match(html, /<math[ >]/, 'KaTeX の MathML が生成されていません');
assert.match(html, /<thead(?:\s|>)/, 'table header が生成されていません');
assert.match(html, /<tbody(?:\s|>)/, 'table body が生成されていません');
assert.match(html, /scope="col"/, 'column header scope がありません');
assert.match(html, /scope="row"/, 'row header scope がありません');
assert.match(html, /class="language-python"/, 'code の language class がありません');
assert.match(html, /data-language="Python"/, 'code の元言語が保持されていません');
assert.equal((html.match(/<figure class="article-figure"/g) ?? []).length, 6, '6 図が必要です');
assert.equal((html.match(/<figcaption(?:\s|>)/g) ?? []).length, 7, '6 図と code の caption が必要です');
// scope 属性の有無に依存しない形で見る（属性は下の assertScopedStyleApplies が別途確認する）
assert.match(html, /<div class="notion-content"[^>]*><h2>Legacy fixture<\/h2>/, 'legacy renderer が退行しています');
assert.match(html, /<strong>太字<\/strong>/, 'legacy の Markdown 装飾が失われています');
assert.match(html, /<a href="\/about">内部リンク<\/a>/, 'legacy の内部リンクが失われています');
assert.match(html, /<meta name="description" content="共通 article shell の fixture">/, 'SEO description がありません');
assert.match(html, /<header class="article-header"/, '共通 article header がありません');
assert.match(html, /<span class="series-badge"[^>]*>AIと統計学<\/span>/, 'series badge がありません');
assert.match(html, /<time datetime="2026-09-08T00:00:00.000Z">/, '公開日が semantic time でありません');
assert.match(html, /<nav class="article-tags" aria-label="記事のタグ"/, 'tag navigation が semantic でありません');
assert.match(html, /<footer class="article-footer"/, '記事後セクションの配置境界がありません');
assert.match(html, /id="comments-fixture"/, 'コメント欄用 slot が描画されていません');
assert.match(html, /<nav class="series-navigation" aria-label="AIと統計学シリーズ内の記事"/, 'series navigation が semantic でありません');
assert.match(html, /href="\/posts\/statistics-02"/, 'prev の slug URL がありません');
assert.match(html, /href="\/posts\/statistics-04"/, 'next の slug URL がありません');
assert.doesNotMatch(html, /amazonaws\.com|philosophizing-with-ai\.com/, '禁止ホストが残っています');

// KaTeX の視覚層は支援技術から隠し、MathML だけを読ませる
assert.match(html, /class="katex-html" aria-hidden="true"/, 'KaTeX の視覚層が aria-hidden ではありません');

// code の中身が text として escape されている（renderer が生 HTML を出さない）
assert.doesNotMatch(html, /<script>alert/, 'code/本文の内容が生の要素として出ています');

// 空の table 枠を出さない（#18 で閉じた不変条件が stack 上でも保たれているか）
assert.doesNotMatch(html, /<tbody[^>]*>\s*<\/tbody>/, '中身の無い tbody が出力されています');

// **見た目が本当に当たるか。** 文字列一致だけでは、div を子コンポーネントへ
// 切り出して style を親に残した場合の退行（生成 HTML から scope 属性が消え、
// CSS が 1 つも当たらない）を検出できない
const css = await emittedCss();
assertScopedStyleApplies(css, 'notion-content', 'line-height:1\\.8');
// インライン数式は自前の scroll container を持たない。shell 側で幅を止めないと
// 記事 1 本ぶんの横スクロールがモバイルで出る
assert.match(
  css,
  /\.article-body\[data-astro-cid-[a-z0-9]+\][^{]*\.article-math--inline[^{]*\{[^}]*overflow-x:auto/,
  'インライン数式に横方向の封じ込めがありません（記事全体が横スクロールします）',
);
assertScopedStyleApplies(css, 'article-content', 'line-height:1\\.8');
assert.match(
  css,
  /\.notion-content\[data-astro-cid-[a-z0-9]+\][^{]*(img|video|pre)[^{]*\{[^}]*max-width:100%/,
  'legacy 本文の img/video/pre に max-width が当たっていません（画像とコードが横にはみ出します）',
);

console.log('fixture build output: renderer / media / URL / scoped-style invariants are valid');
