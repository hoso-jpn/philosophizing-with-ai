import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 外部の画像をビルド時にダウンロードし、`public/notion-static/` へ置いて
 * サイト内の絶対パスを返す。
 *
 * なぜ必要か:
 *
 * 1. Notion の HeroImage は署名付き S3 URL で、**有効期限が 1 時間**
 *    （`X-Amz-Expires=3600`。2026-09-03 実測）。SSR の間は毎リクエスト
 *    取り直していたので露見しなかったが、SSG 化すると URL がビルド時に
 *    HTML へ焼き込まれ、1 時間後に画像が全滅する。
 * 2. 本文（Gutenberg HTML）の画像は旧ドメインを指している。旧ドメインを
 *    止める前にローカルへ取り込んでおく必要がある。
 *
 * 失敗したら例外を投げる。取得できなかった画像を元 URL のまま通すと、
 * ビルドは成功したのに後から画像だけ壊れる——このリポジトリで一貫して
 * 潰してきた「静かに空になる」形になるため。
 */

/** ダウンロード先。`.gitignore` 済み（ビルド成果物であってソースではない） */
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'notion-static');
const PUBLIC_PREFIX = '/notion-static';

/** 拡張子が URL から判別できなかった場合に content-type から補う */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};

const KNOWN_EXTENSIONS = new Set(Object.values(MIME_EXTENSIONS));

/**
 * ファイル名を決める。
 *
 * ハッシュの材料は **origin + pathname だけ**でクエリを含めない。
 * Notion の S3 URL は署名（X-Amz-Signature 等）が取得のたびに変わるため、
 * URL 全体をハッシュすると毎ビルドで別名になり、キャッシュが効かず
 * `public/notion-static/` が際限なく増える。S3 のオブジェクトパスは安定している。
 */
export function buildFileName(url: URL, extension: string): string {
  const digest = createHash('sha256').update(`${url.origin}${url.pathname}`).digest('hex');
  return `${digest.slice(0, 16)}${extension}`;
}

function extensionFromPath(url: URL): string | null {
  const extension = path.extname(decodeURIComponent(url.pathname)).toLowerCase();
  return KNOWN_EXTENSIONS.has(extension) ? extension : null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 画像を 1 枚ローカルへ保存し、`/notion-static/<hash>.<ext>` を返す。
 *
 * 同じ画像が既に落ちていれば再取得しない（同じ画像が複数記事から参照されても
 * 1 回で済む）。`context` は失敗時のログ用で、記事の slug などを渡す。
 */
export async function saveImageLocally(url: string, context: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 相対パスなどはローカル化の対象外。そのまま通す
    return url;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;

  const extensionHint = extensionFromPath(parsed);
  if (extensionHint) {
    const cachedName = buildFileName(parsed, extensionHint);
    if (await exists(path.join(OUTPUT_DIR, cachedName))) return `${PUBLIC_PREFIX}/${cachedName}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `画像を取得できませんでした（${context}）: ${response.status} ${response.statusText}\n` +
        `  ${parsed.origin}${parsed.pathname}\n` +
        '  旧ドメインの停止や Notion の署名期限切れが原因のことがあります。',
    );
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  const extension = extensionHint ?? MIME_EXTENSIONS[contentType];
  if (!extension) {
    throw new Error(
      `画像の拡張子を判別できませんでした（${context}）: content-type=${contentType || '(なし)'}\n` +
        `  ${parsed.origin}${parsed.pathname}`,
    );
  }

  const fileName = buildFileName(parsed, extension);
  const filePath = path.join(OUTPUT_DIR, fileName);

  if (!(await exists(filePath))) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));

    // 外部の画像を自分のサーバーへ複製する行為は、ホットリンクとは権利上の意味が
    // 違う。黙って起きてはいけないので、実際にダウンロードしたときは必ず 1 行残す。
    // URL はクエリを落として出す。Notion の署名付き URL は X-Amz-Signature /
    // X-Amz-Security-Token を含み、これをビルドログへ流すべきではないため。
    // 複製元の把握には origin + pathname で足りる。
    console.log(`[images] localized: ${parsed.origin}${parsed.pathname} → ${PUBLIC_PREFIX}/${fileName} (${context})`);
  }

  return `${PUBLIC_PREFIX}/${fileName}`;
}

/** 本文 HTML から `<img src>` の値を取り出す（重複は除く） */
export function extractImageSources(content: string): string[] {
  return [...new Set([...content.matchAll(/<img[^>]+?src=["']([^"']+)["']/gi)].map((m) => m[1]))];
}

/** http(s) を指しているか。`/images/...` や相対パス、data: は false */
function isExternal(source: string): boolean {
  try {
    const { protocol } = new URL(source);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export class ExternalContentImageError extends Error {
  constructor(offenders: { slug: string; sources: string[] }[]) {
    const total = offenders.reduce((n, o) => n + o.sources.length, 0);
    super(
      `ローカル化を通したのに、本文に外部の画像 URL が残っています` +
        `（${offenders.length} 記事・計 ${total} 箇所）。\n\n` +
        offenders
          .map((o) => `記事「${o.slug}」\n` + o.sources.map((x) => `  - ${x}`).join('\n'))
          .join('\n\n') +
        '\n\n' +
        'localizeContentImages は外部 URL を必ずダウンロードして /notion-static/ へ\n' +
        '置き換えるか、失敗して例外を投げるかのどちらかになるはずで、外部 URL が\n' +
        '残るのは想定外です。src/lib/download-image.ts の実装を確認してください。\n' +
        '（本文へ手で図を入れる場合は public/images/ に置いて /images/<file> で\n' +
        '参照します。手順は README「本文に図を入れる」）',
    );
    this.name = 'ExternalContentImageError';
  }
}

/**
 * ローカル化のあとに外部 URL の画像が残っていないことを確かめる。
 *
 * ポリシー検査ではなく **事後条件**。localizeContentImages を通した結果に対して
 * 呼ぶ。あちらは外部 URL をダウンロードして置き換えるか例外を投げるかのどちらか
 * なので、ここに引っかかるのは実装が壊れたときだけ。不変条件として置いておく。
 *
 * ポリシー検査（「外部 URL を書くな」）にしないのは、Phase 5 でページ本文へ移すと
 * ブロックレンダラーが Notion の S3 URL を出力するため。ポリシーだとそれが弾かれ、
 * 原因の分かりにくい失敗になる。ローカル化を先に通せばそのまま取り込める。
 *
 * 対象は **公開記事だけ**。下書きは getPosts の Published フィルタで
 * そもそも取得されないので、ここへは渡ってこない。
 */
export function assertNoExternalContentImages(posts: { slug: string; content: string }[]): void {
  const offenders = posts
    .map((post) => ({ slug: post.slug, sources: extractImageSources(post.content).filter(isExternal) }))
    .filter((entry) => entry.sources.length > 0);

  if (offenders.length > 0) throw new ExternalContentImageError(offenders);
}

/** 本文 HTML の `<img src>` を、ローカルへ保存した画像へ差し替える */
export async function localizeContentImages(content: string, context: string): Promise<string> {
  const sources = extractImageSources(content);
  if (sources.length === 0) return content;

  const replacements = new Map<string, string>();
  for (const source of sources) {
    replacements.set(source, await saveImageLocally(source, context));
  }

  let localized = content;
  for (const [from, to] of replacements) {
    if (from === to) continue;
    localized = localized.split(from).join(to);
  }
  return localized;
}
