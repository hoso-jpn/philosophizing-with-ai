import { collectArticleRichText, plainTextOfRichText } from './article-document.ts';
import type { Post } from './types.ts';

const DEFAULT_MAX_LENGTH = 160;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function legacyVisibleText(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#-]+/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function truncate(value: string, maxLength: number): string {
  const points = [...value];
  return points.length <= maxLength ? value : `${points.slice(0, maxLength - 1).join('')}…`;
}

/** 空 description の記事でも、本文に基づく有用な SEO description を返す。 */
export function articleDescription(post: Post, maxLength = DEFAULT_MAX_LENGTH): string {
  const explicit = normalize(post.description);
  if (explicit) return truncate(explicit, maxLength);

  const body = post.contentSource.kind === 'legacy'
    ? legacyVisibleText(post.contentSource.content)
    : collectArticleRichText(post.contentSource.document)
        .map(({ nodes }) => plainTextOfRichText(nodes))
        .join(' ');

  return truncate(normalize(body) || post.title, maxLength);
}
