import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../tests/fixture/dist/index.html', import.meta.url), 'utf-8');

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
assert.match(html, /<div class="notion-content"><h2>Legacy fixture<\/h2>/, 'legacy renderer が退行しています');
assert.match(html, /<strong>太字<\/strong>/, 'legacy の Markdown 装飾が失われています');
assert.match(html, /<a href="\/about">内部リンク<\/a>/, 'legacy の内部リンクが失われています');
assert.doesNotMatch(html, /amazonaws\.com|philosophizing-with-ai\.com/, '禁止ホストが残っています');

console.log('fixture build output: renderer / media / URL invariants are valid');
