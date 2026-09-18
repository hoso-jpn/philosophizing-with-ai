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
 *
 * 検査したいページを `source` で選ぶ。既定は記事 fixture（index.html）。
 * CSS が少なく link が 1 つも出ないページ（トップの fixture）だけ
 * `requireLinkedSheet: false` を渡す。
 */
async function emittedCss(source = html, { requireLinkedSheet = true } = {}) {
  const hrefs = [...source.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => href.startsWith('/') && !href.startsWith('//'));
  if (requireLinkedSheet) {
    assert.notEqual(hrefs.length, 0, '自サイトの stylesheet が 1 つも出力されていません');
  }
  const sheets = await Promise.all(
    hrefs.map((href) => readFile(new URL(`.${href}`, distRoot), 'utf-8')),
  );
  // ページ追加でCSSが共通chunkへ分割されると、Astroは小さなchunkをinline化する。
  // linkだけでは実際に適用されるCSSの一部を見落とす。逆に、CSSの少ないページは
  // link が 1 つも出ず全部inlineになる（トップの fixture がこれ）。
  const inlineStyles = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const css = [...sheets, ...inlineStyles].join('\n');
  // 出力の形（link / inline）はAstroのchunk分割次第だが、検査対象のCSSが
  // 1文字も無い状態は素通しさせない。以降のscoped style検査が空振りになる
  assert.notEqual(css.trim(), '', '自サイトのCSSが1つも出力されていません');
  return css;
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
function assertScopedStyleApplies(css, className, expectedDeclaration, source = html) {
  // 見出し（h1/h3）も対象になるので、タグ名に数字を許す
  const tag = source.match(new RegExp(`<[a-z][a-z0-9]* class="${className}"[^>]*>`));
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
// 前後の「向き」と記事名の両方がリンクの読み上げ名に入ること。向きが視覚だけに
// 出ていると、支援技術では 2 つのリンクの区別が付かない
assert.match(
  html,
  /--previous"[^>]*>\s*<span class="series-navigation__direction"[^>]*>← 前の記事<\/span>\s*<span class="series-navigation__title"[^>]*>AIと統計学02；前の記事<\/span>/,
  'prev リンクに向きと記事名が揃っていません',
);
assert.match(
  html,
  /--next"[^>]*>\s*<span class="series-navigation__direction"[^>]*>次の記事 →<\/span>\s*<span class="series-navigation__title"[^>]*>AIと統計学04；次の記事<\/span>/,
  'next リンクに向きと記事名が揃っていません',
);
// 空の href / 中身の無いリンクを出さない
assert.doesNotMatch(html, /<a[^>]*class="series-navigation__link[^"]*"[^>]*href=""/, '空 href のリンクがあります');
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
// シリーズ navigation を持たない記事に、中身の無い記事後 footer を出さない。
// 出ると border-top の線と上下 5rem の余白だけが記事末尾に残る
const noSeriesHtml = await readFile(new URL('no-series/index.html', distRoot), 'utf-8');
assert.doesNotMatch(noSeriesHtml, /article-footer/, 'nav の無い記事に空の記事後 footer が出ています');
assert.doesNotMatch(noSeriesHtml, /series-navigation/, 'nav の無い記事に series navigation が出ています');
assert.match(noSeriesHtml, /<div class="notion-content"/, 'nav の無い記事の本文が描画されていません');

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

// Astroが出力したscriptを検査する。設定前はsectionも外部通信も追加しない。
const commentsHtml = await readFile(new URL('comments/index.html', distRoot), 'utf-8');
const commentsScript = commentsHtml.match(/<script\b[^>]*src="https:\/\/giscus\.app\/client\.js"[^>]*>/)?.[0];
assert.ok(commentsScript, 'giscusのscriptが生成されていません');
for (const attribute of [
  'data-repo="hoso-jpn/philosophizing-with-ai"', 'data-repo-id="R_kgDORl9JSg"',
  'data-category="Announcements"', 'data-category-id="DIC_fixture"',
  'data-mapping="pathname"', 'data-strict="1"', 'data-reactions-enabled="1"',
  'data-theme="dark"', 'data-lang="ja"', 'data-loading="lazy"',
  'crossorigin="anonymous"', 'async',
]) assert.ok(commentsScript.includes(attribute), `giscusに ${attribute} がありません`);
assert.match(commentsHtml, /aria-labelledby="article-comments-heading"/);
assert.match(commentsHtml, /<noscript>/);
assert.match(commentsHtml, /コメントサービスが読み込めなくても、この本文は静的HTMLとして残ります。/);
assert.ok(commentsHtml.indexOf('id="article-comments-heading"') < commentsHtml.indexOf(commentsScript));
const disabledHtml = await readFile(new URL('no-series/index.html', distRoot), 'utf-8');
assert.doesNotMatch(disabledHtml, /giscus\.app|class="article-comments"/);

// ---- トップページの見出し・紹介文・代表記事（Issue #31） ----
//
// 本物の src/pages/index.astro は getPosts() を通るので Notion の認証情報が要る。
// 認証を持たない CI ではトップページが 1 度も描かれないため、同じコンポーネントへ
// fixture の記事を渡したページを検査する。**代表記事が実際に出る正のケース**を見るのが
// 要点で、「本番 slug は fixture に無いので常に空」という検査だけにしない。
const homeHtml = await readFile(new URL('home/index.html', distRoot), 'utf-8');

assert.match(
  homeHtml,
  /<title>AIと哲学・研究・実装の記録 \| Philosophizing with AI<\/title>/,
  'トップの title が意図どおりではありません',
);
assert.match(
  homeHtml,
  /<meta name="description" content="AIとの対話、研究、実装を通じて、[^"]*各シリーズの代表記事から[^"]*">/,
  'トップ専用の meta description が出ていません',
);

// title / description / OGP の整合。片方だけ直して SNS のカードが古いまま、を防ぐ
const homeTitle = homeHtml.match(/<title>([^<]*)<\/title>/)?.[1];
const homeDescription = homeHtml.match(/<meta name="description" content="([^"]*)"/)?.[1];
assert.ok(homeTitle && homeDescription, 'トップの title / description が読めません');
for (const [property, expected] of [
  ['og:title', homeTitle], ['og:description', homeDescription],
  ['twitter:title', homeTitle], ['twitter:description', homeDescription],
]) {
  assert.ok(
    homeHtml.includes(`<meta property="${property}" content="${expected}">`),
    `${property} が title / description と食い違っています`,
  );
}

// h1 は 1 つだけ。見出しの階層が 2 つの h1 に割れると、文書の主題が定まらない
assert.equal((homeHtml.match(/<h1[\s>]/g) ?? []).length, 1, 'トップの h1 が 1 つではありません');
assert.match(
  homeHtml,
  /<h1 class="home-heading"[^>]*>AIと哲学・研究・実装の記録<\/h1>/,
  'トップの主見出しが意図どおりではありません',
);

// 紹介文と About への導線
assert.match(homeHtml, /AIとの対話と、研究・実装の経験を手がかりに/, '紹介文の 1 段落目がありません');
assert.match(homeHtml, /根拠と推論、筆者の立場を区別しながら記録しています。/, '紹介文の 2 段落目がありません');
assert.match(
  homeHtml,
  /<a href="\/about" class="home-about-link"[^>]*>このブログについて<\/a>/,
  'About への導線がありません',
);

// 「初めての方へ」：代表記事が実際に描かれている
assert.match(
  homeHtml,
  /<section class="featured" aria-labelledby="featured-heading"/,
  '代表記事セクションが semantic でありません',
);
assert.match(homeHtml, /id="featured-heading"[^>]*>初めての方へ</, '「初めての方へ」の見出しがありません');

// 順序は選定設定のとおりで決定的、かつ同じ記事が 2 回出ない。
// 通常の a 要素なので JavaScript 無しでも移動できる
const featuredHrefs = [...homeHtml.matchAll(/<a href="([^"]+)" class="featured-link"/g)].map((m) => m[1]);
assert.deepEqual(
  featuredHrefs,
  ['/posts/fixture-implementation', '/posts/fixture-philosophy', '/posts/fixture-statistics'],
  '代表記事の順序が選定設定どおりではありません',
);
assert.equal(new Set(featuredHrefs).size, featuredHrefs.length, '代表記事が重複しています');
for (const href of featuredHrefs) {
  assert.match(href, /^\/posts\//, '代表記事のリンクが相対パスではありません（D-13）');
}

// 公開記事一覧に無い slug は **リンクにしない**。ここが緩むと、下書きへ戻した記事へ
// トップページから 404 を張ったままビルドが成功する
assert.doesNotMatch(homeHtml, /fixture-unpublished/, '公開一覧に無い slug がトップに出ています');

// 記事タイトルは記事データ側が正。選定設定に固定文字列を持たない
assert.match(
  homeHtml,
  /class="featured-link"[^>]*>AIと哲学01；fixture の哲学記事<\/a>/,
  '代表記事のタイトルが記事データから来ていません',
);
assert.match(homeHtml, /<span class="featured-series"[^>]*>AIと実装<\/span>/, 'シリーズ名が出ていません');
assert.match(homeHtml, /<time datetime="2025-12-11T00:00:00.000Z">/, '公開日が semantic time でありません');
assert.match(homeHtml, /fixture の統計記事の紹介文。/, '代表記事の紹介文が出ていません');

// 代表記事の追加で、既存の記事一覧への導線が消えていないこと
assert.match(homeHtml, /<h2>シリーズ別<\/h2>/, '既存のシリーズ別セクションが消えています');

// 代表記事が 1 件も解決できない場合、セクションごと出さない。
// 見出しと枠だけが残ると、壊れているのか意図的に空なのか読者に区別が付かない。
// 主見出し・紹介文・既存一覧はそのまま残る
const homeEmptyHtml = await readFile(new URL('home-no-featured/index.html', distRoot), 'utf-8');
assert.doesNotMatch(homeEmptyHtml, /class="featured"/, '代表記事が無いのに空のセクションが出ています');
assert.doesNotMatch(homeEmptyHtml, /初めての方へ/, '代表記事が無いのに見出しだけ残っています');
assert.match(homeEmptyHtml, /<h1 class="home-heading"/, '代表記事が無いと主見出しまで消えています');
assert.match(homeEmptyHtml, /AIとの対話と、研究・実装の経験を手がかりに/, '代表記事が無いと紹介文まで消えています');
assert.match(homeEmptyHtml, /<h2>シリーズ別<\/h2>/, '代表記事が無いと既存一覧まで壊れています');
assert.match(homeEmptyHtml, /href="\/posts\/fixture-philosophy"/, '既存の公開記事への導線が失われています');

// **見た目が本当に当たるか。** 長いタイトル・紹介文をスマートフォン幅で
// 折り返す指定が、scope 属性の食い違いで 1 つも当たらない状態を弾く
const homeCss = await emittedCss(homeHtml, { requireLinkedSheet: false });
assertScopedStyleApplies(homeCss, 'home-heading', 'overflow-wrap:anywhere', homeHtml);
assertScopedStyleApplies(homeCss, 'featured-title', 'overflow-wrap:anywhere', homeHtml);
assertScopedStyleApplies(homeCss, 'featured-summary', 'overflow-wrap:anywhere', homeHtml);
// grid の列は既定 (auto) だと中身の最小幅で広がる。min-width:0 が無いと
// 折り返せない長い文字列でカードがページ幅を超え、横スクロールが出る
assertScopedStyleApplies(homeCss, 'featured-item', 'min-width:0', homeHtml);
// 暗い配色では既定の focus ring が見えにくい。キーボード操作の現在地を必ず残す
for (const className of ['featured-link', 'home-about-link']) {
  assert.match(
    homeCss,
    new RegExp(`\\.${className}\\[data-astro-cid-[a-z0-9]+\\]:focus-visible\\{[^}]*outline:`),
    `${className} に focus の表示がありません`,
  );
}

console.log('fixture build output: renderer / media / URL / scoped-style / comments / home invariants are valid');
