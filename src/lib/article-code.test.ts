import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codeLanguageClass } from './article-code.ts';

describe('codeLanguageClass', () => {
  it('一般的な言語名を保持する', () => {
    assert.equal(codeLanguageClass('TypeScript'), 'language-typescript');
  });

  it('空白を含む Notion の表示名を class として正規化する', () => {
    assert.equal(codeLanguageClass('Plain Text'), 'language-plain-text');
  });

  it('属性を壊しうる文字を class に持ち込まない', () => {
    assert.equal(codeLanguageClass('ts" onload="x'), 'language-ts-onload-x');
  });

  it('未指定・空文字なら class を付けない', () => {
    assert.equal(codeLanguageClass(null), undefined);
    assert.equal(codeLanguageClass('  '), undefined);
  });
});
