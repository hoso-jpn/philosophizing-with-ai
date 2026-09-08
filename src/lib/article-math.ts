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
        hintFor(cause) +
        '\n壊れた数式を公開しないため、ビルドを止めます。',
      { cause },
    );
    this.name = 'ArticleMathRenderError';
  }
}

/**
 * KaTeX のメッセージだけでは直し方が分からない失敗に、具体的な直し方を添える。
 *
 * 日本語の科学記事では `strict: 'error'` が最初に当たる壁が
 * 「数式モードに素の日本語を書いた」場合で、KaTeX の生メッセージは
 * `Unicode text character "面" used in math mode` としか言わない。
 * どう書き直せばよいのかがそこには無いので、ここで補う。
 */
function hintFor(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message.includes('unicodeTextInMathMode') || message.includes('used in math mode')) {
    return (
      '\n  数式モードに素の日本語（や記号）が置かれています。' +
      '文章として出したい部分は \\text{…} で囲んでください（例: x_{\\text{合計}}）。'
    );
  }
  if (message.includes('unknownSymbol') || message.includes('No character metrics')) {
    return '\n  KaTeX が字形を持たない文字です。絵文字などは数式ではなく本文へ書いてください。';
  }
  return '';
}

/**
 * KaTeX の trust 機能を要求するコマンドに当たったことを表す。
 *
 * **`trust: false` は「落ちる」ではなく「そのコマンドを赤字で描く」。** 実測で、
 * `\href` / `\url` / `\includegraphics` はいずれも例外を投げず、コマンド名が
 * `color:#cc0000` の文字として出力へ入る（リンクや img 要素は生成されないので
 * XSS にはならないが、記事には赤い `\href` の文字だけが公開される）。
 * `throwOnError` は ParseError にしか効かないため、ここは素通りしていた。
 *
 * trust をコールバックにして投げると、その場で build を止められる。安全な入力では
 * KaTeX がこのコールバックを一度も呼ばないので、正常系の費用はゼロ。
 */
export class ArticleMathTrustError extends Error {
  constructor(command: string) {
    super(
      `${command} は KaTeX の trust 機能を要求するコマンドです（許可していません）。\n` +
        '  URL や生 HTML を数式から生成させないため、このコマンドは受け付けません。\n' +
        '  リンクは数式の外に、図は画像ブロックとして置いてください。',
    );
    this.name = 'ArticleMathTrustError';
  }
}

/**
 * Notion が equation として返した式だけを KaTeX SSR する。
 *
 * - `throwOnError`: 不正な TeX を赤字 fallback にせず build failure にする
 * - `strict: error`: KaTeX が非互換・曖昧と判断した入力も公開前に止める
 * - `trust`: 信頼コマンドは黙って赤字にせず、当たった時点で build を止める
 * - `htmlAndMathml`: 見た目と支援技術向け MathML を両方生成する
 */
export function renderArticleMath(expression: string, context: ArticleMathContext): string {
  if (!expression.trim()) throw new ArticleMathRenderError(expression, context);

  try {
    return katex.renderToString(expression, {
      displayMode: context.displayMode,
      throwOnError: true,
      strict: 'error',
      trust: (trustContext: { command: string }) => {
        throw new ArticleMathTrustError(trustContext.command);
      },
      output: 'htmlAndMathml',
    });
  } catch (error) {
    if (error instanceof ArticleMathRenderError) throw error;
    throw new ArticleMathRenderError(expression, context, error);
  }
}
