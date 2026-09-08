import katex from 'katex';

export type ArticleMathContext = {
  displayMode: boolean;
  slug?: string;
  blockId?: string;
};

/**
 * 数式を公開用 HTML に変換できなかったことを表す。
 *
 * KaTeX のエラーをそのまま投げると、どの記事・ブロックを直せばよいか分からない。
 * build 時に場所まで分かる診断へ包み直し、壊れた TeX を文字列 fallback で公開しない。
 */
export class ArticleMathRenderError extends Error {
  constructor(expression: string, context: ArticleMathContext, cause?: unknown) {
    const where = [
      context.slug ? `記事「${context.slug}」` : null,
      context.blockId ? `ブロック ${context.blockId}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
    const mode = context.displayMode ? 'display equation' : 'inline equation';
    const detail = cause instanceof Error ? cause.message : String(cause ?? '式が空です');

    super(
      `${mode} を KaTeX で描画できません。${where ? `\n  ${where}` : ''}` +
        `\n  expression: ${JSON.stringify(expression)}` +
        `\n  ${detail}` +
        '\n壊れた数式を公開しないため、ビルドを止めます。',
      { cause },
    );
    this.name = 'ArticleMathRenderError';
  }
}

/**
 * Notion が equation として返した式だけを KaTeX SSR する。
 *
 * - `throwOnError`: 不正な TeX を赤字 fallback にせず build failure にする
 * - `strict: error`: KaTeX が非互換・曖昧と判断した入力も公開前に止める
 * - `trust: false`: URL や HTML を生成できる信頼コマンドを許可しない
 * - `htmlAndMathml`: 見た目と支援技術向け MathML を両方生成する
 */
export function renderArticleMath(expression: string, context: ArticleMathContext): string {
  if (!expression.trim()) throw new ArticleMathRenderError(expression, context);

  try {
    return katex.renderToString(expression, {
      displayMode: context.displayMode,
      throwOnError: true,
      strict: 'error',
      trust: false,
      output: 'htmlAndMathml',
    });
  } catch (error) {
    if (error instanceof ArticleMathRenderError) throw error;
    throw new ArticleMathRenderError(expression, context, error);
  }
}
