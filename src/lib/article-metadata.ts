import { collectArticleRichText, plainTextOfRichText } from './article-document.ts';
import type { Post } from './types.ts';

const DEFAULT_MAX_LENGTH = 160;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 実体参照を戻す。
 *
 * **`&amp;` を最後に処理する。** 先に戻すと `&amp;lt;` が `&lt;` になり、
 * 続く規則でさらに `<` まで戻ってしまう（二重デコード）。
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * description に URL を持ち込まない。
 *
 * 検索結果の抜粋に URL が出ても読者の役に立たないうえ、**本文へ素の URL が
 * 書かれていると、その query ごと meta description に載る**。legacy 本文には
 * Notion の署名付き S3 URL が素のテキストとして残りうるので、
 * `X-Amz-Signature=…` を公開の meta タグへ出さないためにここで落とす。
 */
function stripUrls(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
}

/**
 * legacy 本文（Markdown + 生 HTML）から、読める文字だけを取り出す。
 *
 * **実体参照を戻してからタグを落とす。** 逆順にすると `&lt;script&gt;` が
 * タグ除去を素通りしてから `<script>` に戻り、markup が description に
 * 残ってしまう（実測）。属性値として出るので注入にはならないが、
 * 検索結果に `<script>` という文字列が並ぶことになる。
 */
function legacyVisibleText(content: string): string {
  return stripUrls(
    decodeEntities(content.replace(/<!--[\s\S]*?-->/g, ' '))
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
  ).replace(/[`*_~>#-]+/g, ' ');
}

function truncate(value: string, maxLength: number): string {
  // **コードポイント単位で数える。** UTF-16 の添字で切ると絵文字や CJK 拡張字の
  // 途中で切れて孤立サロゲートが残る（alt の D-44 と同じ理由）
  const points = [...value];
  return points.length <= maxLength ? value : `${points.slice(0, maxLength - 1).join('')}…`;
}

/** 空 description の記事でも、本文に基づく有用な SEO description を返す。 */
export function articleDescription(post: Post, maxLength = DEFAULT_MAX_LENGTH): string {
  const explicit = normalize(post.description);
  if (explicit) return truncate(explicit, maxLength);

  const body = post.contentSource.kind === 'legacy'
    ? legacyVisibleText(post.contentSource.content)
    : stripUrls(
        collectArticleRichText(post.contentSource.document)
          .map(({ nodes }) => plainTextOfRichText(nodes))
          .join(' '),
      );

  return truncate(normalize(body) || post.title, maxLength);
}
