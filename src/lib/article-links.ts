import { findUrlPolicyViolation, type UrlPolicyViolation } from './content-links.ts';
import { collectArticleImages, collectArticleRichText } from './article-document.ts';
import type { ArticleDocument } from './article-document.ts';

/**
 * ページ本文（ArticleDocument）に対する URL の不変条件。
 *
 * legacy `Content` には `assertNoSelfReferencingUrls` が掛かっているが、あれは
 * HTML 文字列を正規表現で走査するもので、型付きの本文には使えない。**規則そのものは
 * content-links.ts に 1 本化**し（D-19 / D-29）、ここは本文の木を漏れなく辿って
 * その規則へ渡すことだけを担う。
 *
 * `safeHref` とは責務を分ける。あちらは `javascript:` などを弾くスキームの安全性
 * （XSS 対策）で、こちらは内部リンクの正規形（D-13）。
 */

export type ArticleUrlViolation = UrlPolicyViolation & {
  /** どのブロックに書かれていたか */
  blockId: string;
  /** リンクか画像か。直し方が変わる */
  origin: 'link' | 'image';
};

/**
 * 本文中の URL を全部集めて規則へ掛ける。
 *
 * 対象は rich text の href と画像の取得元の両方。画像は #6 でローカル化するが、
 * **ローカル化より前に検査する**。自サイトを指す URL は「取得に失敗しました（404）」
 * より「相対パスへ書き換える」と言われた方が直すべきことを直接指すため（D-17）。
 */
export function findArticleUrlViolations(document: ArticleDocument): ArticleUrlViolation[] {
  const violations: ArticleUrlViolation[] = [];

  for (const { blockId, nodes } of collectArticleRichText(document)) {
    for (const node of nodes) {
      if (node.kind !== 'text' || node.href === null) continue;
      const violation = findUrlPolicyViolation(node.href);
      if (violation) violations.push({ ...violation, blockId, origin: 'link' });
    }
  }

  for (const image of collectArticleImages(document)) {
    // ローカル化済みのものはサイト内パスなので対象外
    if (image.source.kind === 'local') continue;
    const violation = findUrlPolicyViolation(image.source.url);
    if (violation) violations.push({ ...violation, blockId: image.id, origin: 'image' });
  }

  return violations;
}

export class ArticleUrlPolicyError extends Error {
  constructor(slug: string, violations: readonly ArticleUrlViolation[]) {
    super(
      `記事「${slug}」のページ本文に、本文へ書いてはいけない URL があります` +
        `（${violations.length} 件）。\n` +
        violations
          .map(
            (v) =>
              `  [${v.origin === 'image' ? '画像' : 'リンク'}] ${v.url}\n` +
              `    ブロック ${v.blockId}\n` +
              `    → ${v.advice}`,
          )
          .join('\n') +
        '\n\n' +
        '内部リンクは相対パスでなければなりません。絶対 URL はドメインを変えたときに\n' +
        'すべて壊れ、プレビューデプロイで踏むと本番へ飛んでしまいます（D-13）。',
    );
    this.name = 'ArticleUrlPolicyError';
  }
}

/** 違反が 1 件でもあればビルドを止める */
export function assertArticleUrlInvariants(
  document: ArticleDocument,
  context: { slug: string },
): void {
  const violations = findArticleUrlViolations(document);
  if (violations.length > 0) throw new ArticleUrlPolicyError(context.slug, violations);
}
