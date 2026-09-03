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

const richTextItem = z.object({
  plain_text: z.string(),
  href: z.string().nullable().optional(),
  annotations: z
    .object({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      strikethrough: z.boolean().optional(),
      underline: z.boolean().optional(),
      code: z.boolean().optional(),
    })
    .optional(),
});

type RichTextItem = z.infer<typeof richTextItem>;

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

const plain = (items: RichTextItem[]) => items.map((t) => t.plain_text).join('');

/**
 * Content は Markdown の原稿として扱う。
 *
 * Notion の rich_text プロパティへ `**bold**` や `[label](url)` を入力すると、
 * Notion はそれらを装飾・リンクへ変換し、plain_text から Markdown の区切り文字を
 * 落とす。そのため Content だけは annotations / href から Markdown を再構成する。
 * 見出し (`##`)、リスト (`-`) や引用 (`>`) は plain_text に残るのでそのまま通る。
 */
function markdown(items: RichTextItem[]): string {
  return items
    .map((item) => {
      let text = item.plain_text;
      const a = item.annotations;

      // 内側から外側へ決定的な順序で復元する。
      if (a?.code) text = `\`${text}\``;
      if (a?.bold) text = `**${text}**`;
      if (a?.italic) text = `*${text}*`;
      if (a?.strikethrough) text = `~~${text}~~`;
      // CommonMark に underline はないため HTML を使う。marked はそのまま描画できる。
      if (a?.underline) text = `<u>${text}</u>`;
      if (item.href) text = `[${text}](${item.href})`;

      return text;
    })
    .join('');
}

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
 *
 * rich_text 配列の「要素数」には上限チェックを置かない。Notion の Retrieve a page
 * にある 25 件制限は rich_text 断片そのものではなく、rich_text 内の page/person
 * mention など参照値の完全性に関する制限。装飾やリンクで 25 断片以上になった正常な
 * 本文を「切り捨て」と誤判定しないため。本文は Phase 5 でページ本文へ移行する予定。
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
  const content = markdown(props.Content.rich_text);

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
  };
}
