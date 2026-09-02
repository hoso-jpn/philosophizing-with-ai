import { z } from 'zod';
import type { Post } from './types.ts';

/**
 * Notion のページオブジェクトを検証して Post に変換する。
 *
 * 目的は「静かに空になる」のを止めること。
 * 以前は props.Title?.rich_text?.[0]?.plain_text || "" という書き方だったため、
 * Notion 側でプロパティ名を変えても例外にならず、空文字のまま公開されていた。
 * ここでは必須プロパティの欠落を例外にし、任意プロパティの欠落は警告に留める。
 */

const richTextItem = z.object({ plain_text: z.string() });

const richTextProp = z.object({ rich_text: z.array(richTextItem) });
const titleProp = z.object({ title: z.array(richTextItem) });
const checkboxProp = z.object({ checkbox: z.boolean() });
const dateProp = z.object({ date: z.object({ start: z.string() }).nullable() });
const filesProp = z.object({
  files: z.array(
    z.object({
      file: z.object({ url: z.string() }).optional(),
      external: z.object({ url: z.string() }).optional(),
    }),
  ),
});
/** Tags は現状 rich_text だが、multi_select へ移行しても壊れないよう両方受ける */
const tagsProp = z.union([richTextProp, z.object({ multi_select: z.array(z.object({ name: z.string() })) })]);

/** 欠けていたらビルドを止めるプロパティ */
const requiredProperties = z.object({
  '名前': titleProp,
  Title: richTextProp,
  Slug: richTextProp,
  Date: dateProp,
  Published: checkboxProp,
  Content: richTextProp,
  Tags: tagsProp,
});

/** 欠けていても警告に留めるプロパティ */
const optionalProperties = z.object({
  Description: richTextProp.optional(),
  HeroImage: filesProp.optional(),
  Status: richTextProp.optional(),
  /** Phase 4 で使う。Notion 側に追加されるまでは存在しない */
  Format: z.union([z.object({ select: z.object({ name: z.string() }).nullable() }), richTextProp]).optional(),
});

const notionPage = z.object({
  id: z.string(),
  properties: z.intersection(requiredProperties, optionalProperties),
});

export class NotionSchemaError extends Error {
  constructor(pageId: string, detail: string) {
    super(
      `Notion のページ ${pageId} を読み取れませんでした。\n${detail}\n` +
        `Notion 側でプロパティ名や型を変更した場合は src/lib/notion-schema.ts も更新してください。`,
    );
    this.name = 'NotionSchemaError';
  }
}

const plain = (items: { plain_text: string }[]) => items.map((t) => t.plain_text).join('');

/** rich_text は 25 要素で打ち切られる。到達したら本文が欠けている可能性がある */
const RICH_TEXT_ELEMENT_LIMIT = 25;

function extractTags(prop: z.infer<typeof tagsProp>): string[] {
  if ('multi_select' in prop) return prop.multi_select.map((t) => t.name).filter(Boolean);
  // 区切り文字は既存実装と同一にしておく（変えるとタグの粒度が変わる）
  return plain(prop.rich_text)
    .split(/[、, ]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ParseWarning = { slug: string; message: string };

/**
 * Notion のページを Post に変換する。
 * 必須の不足は例外、任意の不足は warnings に積む。
 */
export function parsePost(page: unknown, warnings: ParseWarning[] = []): Post {
  const pageId = (page as { id?: string } | null)?.id ?? '(id 不明)';
  const parsed = notionPage.safeParse(page);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new NotionSchemaError(pageId, detail);
  }

  const props = parsed.data.properties;
  const titlePrefix = plain(props['名前'].title).trim();
  const titleBody = plain(props.Title.rich_text).trim();
  const slug = plain(props.Slug.rich_text).trim();
  const content = plain(props.Content.rich_text);

  if (!slug) {
    throw new NotionSchemaError(pageId, '  - Slug: 空です。URL を決められないため公開できません');
  }
  if (!titlePrefix && !titleBody) {
    throw new NotionSchemaError(pageId, '  - 名前 / Title: どちらも空です');
  }
  if (!props.Date.date?.start) {
    throw new NotionSchemaError(pageId, '  - Date: 未設定です');
  }
  if (!content.trim()) {
    throw new NotionSchemaError(pageId, '  - Content: 本文が空です');
  }
  if (props.Content.rich_text.length >= RICH_TEXT_ELEMENT_LIMIT) {
    throw new NotionSchemaError(
      pageId,
      `  - Content: rich_text が ${RICH_TEXT_ELEMENT_LIMIT} 要素に達しています。` +
        `Notion API の上限で本文が切り捨てられている可能性があります`,
    );
  }

  const description = plain(props.Description?.rich_text ?? []).trim();
  if (!description) warnings.push({ slug, message: 'Description が空です' });

  const heroFile = props.HeroImage?.files?.[0];
  const heroImage = heroFile?.file?.url ?? heroFile?.external?.url ?? null;

  const tags = extractTags(props.Tags);
  if (tags.length === 0) warnings.push({ slug, message: 'Tags が空です' });

  return {
    id: parsed.data.id,
    title: titlePrefix && titleBody ? `${titlePrefix}；${titleBody}` : titleBody || titlePrefix,
    titlePrefix,
    titleBody,
    series: null, // Notion に明示的な Series プロパティは存在しない。Phase 4 で Format と併せて扱う
    slug,
    date: props.Date.date.start,
    description,
    tags,
    heroImage,
    content,
    published: props.Published.checkbox,
    status: plain(props.Status?.rich_text ?? []).trim(),
  };
}
