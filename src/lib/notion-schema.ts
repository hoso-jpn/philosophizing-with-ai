import { z } from 'zod';
import { usesPageBodySource } from './migration-allowlist.ts';
import type { ParsedPost } from './types.ts';

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
  Tags: tagsProp,
});

/**
 * legacy 本文。**必須かどうかは記事によって変わる**ため、型の上では任意にしてある。
 *
 * - 本文を Notion のページ本文へ移した記事（migration allowlist 内）は空でよい
 * - それ以外の記事は必須・非空。空なら parsePost が例外にする
 *
 * 型を任意にしただけで検査は緩めていない。既存記事に対しては
 * 「Content プロパティが無い」も「Content が空」も従来どおりビルドを止める。
 */
const legacyContentProperty = richTextProp.optional();

/** 欠けていても警告に留めるプロパティ */
const optionalProperties = z.object({
  Content: legacyContentProperty,
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

const ANNOTATION_KEYS = ['bold', 'italic', 'strikethrough', 'underline', 'code'] as const;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (value: string) => escapeHtml(value).replace(/"/g, '&quot;');

/**
 * インラインコードを CommonMark の規則どおりに囲う。
 *
 * 単純に `` ` `` で挟むと、本文自体がバッククォートを含むとき壊れる
 * （``foo`bar`` → `` `foo`bar` `` は「foo」だけがコードになる）。
 * 中の最長連続バッククォートより 1 本多い区切りを使い、内容が
 * バッククォートで始まる/終わる場合は空白で詰める。
 */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const needsPadding = text.startsWith('`') || text.endsWith('`');
  const padding = needsPadding ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

/**
 * Content を marked へ渡す原稿として組み立てる。
 *
 * Notion の rich_text プロパティへ `**bold**` や `[label](url)` を入力すると、
 * Notion はそれらを装飾・リンクへ変換し、plain_text から Markdown の区切り文字を
 * 落とす。そのため Content だけは annotations / href から装飾を復元する。
 * 見出し (`##`)、リスト (`-`) や引用 (`>`) は plain_text に残るのでそのまま通る。
 *
 * **装飾の無いフラグメントは 1 バイトも触らずに通す。** 既存の Gutenberg HTML 記事は
 * すべて「装飾なし・href なし」なので、この関数を通しても文字列は変化しない（実測）。
 *
 * 装飾には Markdown の区切り文字ではなく HTML タグを使う。CommonMark の
 * flanking 規則では、閉じ側の `**` の直前が全角約物だと強調を閉じられず、
 * `行動を**veto（阻止）**する` がリテラルの `**` として表示される（実測で 4 箇所）。
 * HTML タグはこの規則の影響を受けない。リンクも `<a href>` にすることで、
 * ラベルに `]`、URL に `)` や空白が含まれても壊れない。
 * インラインコードだけは Markdown のまま置く。HTML の `<code>` にすると中身が
 * Markdown として再解釈されてしまい、コードの意味が失われるため。
 */
export function markdown(items: RichTextItem[]): string {
  return items
    .map((item) => {
      const a = item.annotations;
      const decorated = ANNOTATION_KEYS.some((key) => a?.[key] === true);
      if (!decorated && !item.href) return item.plain_text;

      // code の中身は marked がエスケープするので、ここでは触らない
      let text = a?.code ? codeSpan(item.plain_text) : escapeHtml(item.plain_text);

      if (a?.bold) text = `<strong>${text}</strong>`;
      if (a?.italic) text = `<em>${text}</em>`;
      if (a?.strikethrough) text = `<del>${text}</del>`;
      if (a?.underline) text = `<u>${text}</u>`;
      if (item.href) text = `<a href="${escapeAttribute(item.href)}">${text}</a>`;

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
 *
 * `Content` の必須性は記事によって変わる。本文を Notion のページ本文へ移した記事
 * （migration allowlist 内）だけが空を許され、それ以外は従来どおり非空が必須。
 * allowlist は既定で版管理された一覧を見る。判定を差し替えられるのはテスト用。
 */
export function parsePost(
  page: unknown,
  warnings: ParseWarning[] = [],
  usesPageBody: (slug: string) => boolean = usesPageBodySource,
): ParsedPost {
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
  const content = props.Content ? markdown(props.Content.rich_text) : '';

  if (!slug) {
    throw new NotionSchemaError(pageId, '  - Slug: 空です。URL を決められないため公開できません');
  }
  if (!titlePrefix && !titleBody) {
    throw new NotionSchemaError(pageId, '  - 名前 / Title: どちらも空です');
  }
  if (!props.Date.date?.start) {
    throw new NotionSchemaError(pageId, '  - Date: 未設定です');
  }
  // 本文がページ本文へ移っている記事だけ、Content が無くてよい。
  // その場合に本文がどこにも無いことは resolveArticleContentSource が捕まえる
  // （ページ本文を実際に取得してみるまで確定しないため、ここでは判定できない）。
  if (!content.trim() && !usesPageBody(slug)) {
    throw new NotionSchemaError(
      pageId,
      props.Content
        ? '  - Content: 本文が空です'
        : '  - Content: プロパティがありません（本文をページ本文へ移した記事なら ' +
            'src/lib/migration-allowlist.ts に slug を追加してください）',
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
  };
}
