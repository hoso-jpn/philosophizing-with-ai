import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { saveImageLocally, type CacheIdentity } from './download-image.ts';
import { safeUrlForLog } from './content-links.ts';
import { collectArticleImages, mapArticleImages, plainTextOfRichText } from './article-document.ts';
import type { ArticleDocument, ArticleImageBlock } from './article-document.ts';

/**
 * ページ本文の画像をビルド時にローカルへ取り込む。
 *
 * Notion がホストする画像 URL は **署名付きで有効期限がある**（`X-Amz-Expires=3600`。
 * 2026-09-03 実測）。SSG では URL がビルド時に HTML へ焼き込まれるので、そのまま
 * 出すと 1 時間後に図が全滅する。外部 URL も同じ扱いにする。相手のサーバーが
 * 消えれば同じことが起きるうえ、legacy 本文の画像方針（D-15）とも揃う。
 *
 * ダウンロードそのものは既存の download-image.ts をそのまま使う。あちらには
 * MIME 判定・SVG 対応・検証済み成果物の再利用が既にあり、ここで別系統を作ると
 * 挙動が 2 つに分かれる。
 *
 * **同一性（どの URL を同じ画像とみなすか）だけはここで決める。** notion-hosted は
 * 署名クエリが毎回変わるので origin + pathname、external はクエリが中身を決めうるので
 * URL 全体。download-image.ts に既定を 1 つ置いて済ませると、必ずどちらかが壊れる。
 */

/** 保存先。download-image.ts と同じ場所を指す */
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'notion-static');

/** alt に使う caption の長さの上限。全文をコピーすると読み上げが冗長になる */
const MAX_ALT_LENGTH = 120;

export class ArticleImageError extends Error {
  constructor(info: { slug: string; blockId: string; detail: string; hint?: string }) {
    super(
      `記事「${info.slug}」のページ本文の画像を処理できませんでした。\n` +
        `  ブロック: ${info.blockId}\n` +
        `  ${info.detail}\n` +
        (info.hint ? `  ${info.hint}\n` : '') +
        '画像を落としたまま公開すると、図が抜けた記事がビルド成功として出ていきます。',
    );
    this.name = 'ArticleImageError';
  }
}

/**
 * caption から alt を組み立てる。
 *
 * **Notion の画像ブロックに alt 専用の項目は無い**（API の image オブジェクトは
 * type / file | external / caption だけ）。無いものを想定せず、caption を正とする。
 *
 * caption 全文をそのまま alt にはしない。図の説明が長いと読み上げが冗長になり、
 * しかも同じ文字列が figcaption としても読まれる。先頭を要約として使う。
 */
export function altFromCaption(caption: string): string | null {
  const text = caption.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  // **コードポイント単位で数える。** UTF-16 の添字で切ると、絵文字や一部の
  // CJK 拡張字（サロゲートペア）の途中で切れて孤立サロゲートが残り、
  // 読み上げには壊れた文字として届く。
  const characters = [...text];
  if (characters.length <= MAX_ALT_LENGTH) return text;

  // 単語や句の途中で切らない。区切りが無ければ素直に切る
  const head = characters.slice(0, MAX_ALT_LENGTH).join('');
  const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('、'), head.lastIndexOf('。'));
  return `${(boundary > MAX_ALT_LENGTH / 2 ? head.slice(0, boundary) : head).trim()}…`;
}

/**
 * SVG の `<title>` を読む。
 *
 * caption が無い図の代替テキストの拠り所になる。科学図に `alt=""` を当てて
 * 装飾扱いするのは避けたいが、無い説明を勝手に作るのはもっと悪い。SVG 自身が
 * 名乗っているならそれを使う。
 *
 * 先頭だけを見る。図全体を正規表現に掛ける必要はなく、大きな SVG で無駄に
 * 時間を使わないため。
 */
export function svgTitle(svg: string): string | null {
  const matched = svg.slice(0, 4096).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!matched) return null;
  const text = matched[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

async function readSvgTitle(localSrc: string): Promise<string | null> {
  if (!localSrc.endsWith('.svg')) return null;
  try {
    return svgTitle(await readFile(path.join(OUTPUT_DIR, path.basename(localSrc)), 'utf-8'));
  } catch {
    // 読めなくても alt の材料が 1 つ減るだけ。ここで落とす理由はない
    return null;
  }
}

export type LocalizeImageDeps = {
  /** 画像 1 枚をローカルへ保存してサイト内パスを返す。既定は download-image.ts */
  localize?: (url: string, context: string) => Promise<string>;
  /** SVG の title を読む。既定は保存済みファイルから読む */
  readTitle?: (localSrc: string) => Promise<string | null>;
};

/**
 * 画像ブロック 1 件をローカル化する。
 *
 * 取得に失敗したら例外。落とした画像を無かったことにしない（D-15 と同じ方針）。
 */
async function localizeImageBlock(
  image: ArticleImageBlock,
  context: { slug: string },
  deps: LocalizeImageDeps,
): Promise<ArticleImageBlock> {
  if (image.source.kind === 'local') return image;

  // 同一性は取得元の種類で決まる。**ここを 1 つの既定で済ませない。**
  //
  // notion-hosted は署名付き URL で、`X-Amz-Signature` が取得のたびに変わる。
  // クエリを同一性に含めると毎ビルド別ファイルになり、キャッシュが際限なく増える。
  //
  // external はその逆で、クエリが中身を決めることがある（chart / badge / image
  // proxy は `?id=1` と `?id=2` で別の画像を返す）。クエリを落とすと 2 枚目に
  // 1 枚目の中身が出る。ビルドは成功し、警告も出ない。
  const identity: CacheIdentity = image.source.kind === 'notion-hosted' ? 'origin-path' : 'full-url';

  const localize =
    deps.localize ?? ((url: string, context: string) => saveImageLocally(url, context, { identity }));
  const readTitle = deps.readTitle ?? readSvgTitle;
  const { url } = image.source;

  const src = await localize(url, `${context.slug} / ${image.id}`);

  // saveImageLocally は http(s) 以外を素通しする（相対パスなどは対象外という設計）。
  // ページ本文の画像でそれが起きたら取り込めていないので、素通しさせない
  if (!src.startsWith('/')) {
    throw new ArticleImageError({
      slug: context.slug,
      blockId: image.id,
      detail: `ローカルへ取り込めない画像の URL です: ${safeUrlForLog(url)}`,
      hint: 'http(s) の画像 URL だけを扱えます。',
    });
  }

  const captionText = plainTextOfRichText(image.caption);
  const alt = altFromCaption(captionText) ?? (await readTitle(src));

  if (alt === null) {
    throw new ArticleImageError({
      slug: context.slug,
      blockId: image.id,
      detail: '代替テキストを決められませんでした（caption が空で、SVG の title もありません）',
      hint:
        'Notion の画像ブロックに caption を書いてください。' +
        '科学図に alt="" を当てて装飾扱いにはしません。',
    });
  }

  return { ...image, source: { kind: 'local', src }, alt };
}

/**
 * 本文中の画像をすべてローカル化した本文を返す。
 *
 * 同じ URL が複数回出てきても、download-image.ts が検証済み成果物の有無を見て
 * 再取得を避ける。ここで別のキャッシュを重ねない。
 */
export async function localizeArticleDocumentMedia(
  document: ArticleDocument,
  context: { slug: string },
  deps: LocalizeImageDeps = {},
): Promise<ArticleDocument> {
  return mapArticleImages(document, (image) => localizeImageBlock(image, context, deps));
}

export class RemoteArticleImageError extends Error {
  constructor(slug: string, offenders: readonly { blockId: string; url: string }[]) {
    super(
      `記事「${slug}」のページ本文に、ローカル化されていない画像が残っています` +
        `（${offenders.length} 件）。\n` +
        offenders.map((o) => `  - ブロック ${o.blockId}: ${o.url}`).join('\n') +
        '\n\n' +
        'localizeArticleDocumentMedia を通した結果に外部 URL が残るのは想定外です。\n' +
        'このまま公開すると、Notion の署名付き URL が HTML へ焼き込まれ、期限切れで\n' +
        '図が全滅します。src/lib/article-media.ts の実装を確認してください。',
    );
    this.name = 'RemoteArticleImageError';
  }
}

/**
 * ローカル化の事後条件。
 *
 * ポリシー検査ではなく **事後条件**。localizeArticleDocumentMedia は取り込むか
 * 例外を投げるかのどちらかなので、ここに引っかかるのは実装が壊れたときだけ。
 * legacy 本文の assertNoExternalContentImages と同じ役割（D-15）。
 */
export function assertNoRemoteArticleImages(
  document: ArticleDocument,
  context: { slug: string },
): void {
  const offenders = collectArticleImages(document)
    .filter((image) => image.source.kind !== 'local')
    .map((image) => ({
      blockId: image.id,
      url: image.source.kind === 'local' ? image.source.src : safeUrlForLog(image.source.url),
    }));

  if (offenders.length > 0) throw new RemoteArticleImageError(context.slug, offenders);
}
