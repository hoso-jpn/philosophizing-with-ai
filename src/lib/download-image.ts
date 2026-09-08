import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
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
 *
 * キャッシュについては 2 つの不変条件を守る（D-48）。
 *
 * 1. **再利用してよいのは検証を通した成果物だけ。** 「その名前のファイルが存在する」
 *    ことは再利用の理由にならない。以前はそれだけで fetch ごと飛ばしていたため、
 *    旧実装が `text/html` を `.svg` として保存した成果物が、content-type の検証を
 *    1 つも受けずに公開され続けていた（実測）
 * 2. **同一性の policy は呼び出し側が決める。** 署名付き URL（クエリが毎回変わる）と
 *    外部 URL（クエリが中身を決めうる）を 1 つの既定で扱うと、必ずどちらかが壊れる
 */

/** ダウンロード先。`.gitignore` 済み（ビルド成果物であってソースではない） */
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'public', 'notion-static');
const PUBLIC_PREFIX = '/notion-static';

/**
 * 検証記録の置き場。**`public/` の外に置く。**
 *
 * Astro は `public/` を **ページ描画より前に** 出力へコピーする。記録を画像の隣
 * （`public/notion-static/`）へ置くと、2 回目以降のビルドでは記録が既にそこに
 * あるため、Astro のコピーによって出力へ入ってしまう。copy-downloaded-images 側で
 * 除外しても、あちらのコピーは後から走るので手遅れになる（実測で確認）。
 *
 * 記録は「この成果物は検証を通した」というビルド用の状態であって、公開する意味が
 * 無い（取得元のパスが読者から見えるだけになる）。`node_modules/.cache/` は
 * ビルドキャッシュの慣習的な置き場で、`.gitignore` 済みでもある。
 */
const DEFAULT_METADATA_DIR = path.join(process.cwd(), 'node_modules', '.cache', 'notion-static');

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
 * URL の **どこまでが「どの画像か」を決めるか**。
 *
 * ここを 1 つの既定で済ませていたのが誤りだった。以前は常に origin + pathname だけを
 * ハッシュしていたため、
 *
 *   https://charts.example/render?id=1
 *   https://charts.example/render?id=2
 *
 * が同じファイルへ潰れ、2 枚目に 1 枚目の中身が出ていた（実測）。検証は通るので
 * ビルドは成功し、誰も気づけない——このリポジトリが一貫して潰してきた
 * 「静かに壊れる」形そのものである。
 *
 * - `origin-path` … クエリを同一性に含めない。**Notion の署名付き URL 専用**。
 *   `X-Amz-Signature` は取得のたびに変わるので、含めると毎ビルド別名になり
 *   `public/notion-static/` が際限なく増える。S3 のオブジェクトパスは安定している
 * - `full-url` … クエリまで含めて同一性とする。**既定はこちら**。
 *   クエリで中身が変わる配信元（chart / badge / image proxy）を潰さない
 *
 * 既定を安全側（`full-url`）に置くのが要点。取り違えた画像を出すより、
 * 同じ画像が 2 つ落ちる方がはるかに軽い。
 */
export type CacheIdentity = 'origin-path' | 'full-url';

export type SaveImageOptions = {
  /** URL のどこまでを同一性に使うか。既定は 'full-url'（安全側） */
  identity?: CacheIdentity;
  /**
   * 画像の保存先。既定は `public/notion-static`。
   *
   * テストが実キャッシュを汚さないために差し替える。以前はテストが本物の
   * `public/notion-static/` へ書き込み、その残骸が `dist` まで運ばれていた。
   */
  outputDir?: string;
  /** 検証記録の保存先。既定は `node_modules/.cache/notion-static`（public の外） */
  metadataDir?: string;
};

/** 同一性の材料になる文字列 */
function identityOf(url: URL, identity: CacheIdentity): string {
  return identity === 'origin-path'
    ? `${url.origin}${url.pathname}`
    : `${url.origin}${url.pathname}${url.search}`;
}

function digestOf(url: URL, identity: CacheIdentity): string {
  return createHash('sha256').update(identityOf(url, identity)).digest('hex').slice(0, 16);
}

/**
 * ファイル名を決める。
 *
 * `identity` は呼び出し側が明示する。既定値を持たせない——「どちらの意味の URL か」は
 * 呼び出し側にしか分からず、ここで黙って決めると上記の取り違えが再発する。
 */
export function buildFileName(url: URL, extension: string, identity: CacheIdentity): string {
  return `${digestOf(url, identity)}${extension}`;
}

/**
 * URL のパスから拡張子を読む。
 *
 * 壊れた percent 表記（`/a%E0%A4.png`、`/100%.png`）では `decodeURIComponent` が
 * 素の `URIError: URI malformed` を投げていた。fail closed ではあるが、記事も URL も
 * 付かないため原因が分からない。落とすのは同じまま、診断できる形へ変換する。
 */
function extensionFromPath(url: URL, context: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    throw new Error(
      `画像 URL の % 表記が壊れています（${context}）\n` +
        `  ${url.origin}${url.pathname}\n` +
        '  パーセントエンコーディングとして解釈できない並びが含まれています' +
        '（`%E0%A4` のような不完全なバイト列や、単独の `%`）。\n' +
        '  Notion 側で画像を貼り直すか、ファイル名から % を外してください。',
    );
  }
  const extension = path.extname(decoded).toLowerCase();
  return KNOWN_EXTENSIONS.has(extension) ? extension : null;
}

/** 実ファイルのバイト数。無ければ null */
async function fileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ content-type の規則 */

function isImageContentType(contentType: string): boolean {
  // サブタイプまで既知であることは求めない。**Notion の実データに
  // `content-type: image` という、サブタイプの無い応答が実在する**
  // （intelligence-efficiency-ai-vs-brain のアイキャッチ。2026-09-06 実測）。
  // ここを厳しくすると正常な画像でビルドが止まる。止めたいのは
  // 「画像ではないものが画像として保存される」ことだけ。
  return contentType === 'image' || contentType.startsWith('image/');
}

type ExtensionDecision =
  | { ok: true; extension: string }
  | { ok: false; reason: 'not-image' | 'unknown-extension' | 'mismatch'; mimeExtension: string | null };

/**
 * content-type と URL の拡張子から、保存すべき拡張子を決める。
 *
 * **判定はこの 1 か所だけ。** 取得経路とキャッシュ再利用経路の両方がここを通る。
 * 2 か所に分けると、片方だけ緩いという形でしかズレず、しかも緩い側が
 * 「検証済み」を名乗るので気づけない。
 */
function decideExtension(contentType: string, extensionHint: string | null): ExtensionDecision {
  if (!isImageContentType(contentType)) return { ok: false, reason: 'not-image', mimeExtension: null };

  // 拡張子は content-type を優先し、判別できない画像種別だけ URL の拡張子で補う
  const mimeExtension = MIME_EXTENSIONS[contentType] ?? null;
  const extension = mimeExtension ?? extensionHint;
  if (!extension) return { ok: false, reason: 'unknown-extension', mimeExtension };

  // 両方が分かっていて食い違う場合は落とす。出力は拡張子でしか配信されない
  // （`/notion-static/<hash>.svg` は image/svg+xml として返る）ため、
  // どちらへ寄せても読者には壊れた画像が見える
  if (mimeExtension && extensionHint && mimeExtension !== extensionHint) {
    return { ok: false, reason: 'mismatch', mimeExtension };
  }
  return { ok: true, extension };
}

function extensionError(
  decision: Extract<ExtensionDecision, { ok: false }>,
  contentType: string,
  extensionHint: string | null,
  where: string,
  context: string,
): Error {
  if (decision.reason === 'not-image') {
    return new Error(
      `画像ではない応答が返りました（${context}）: content-type=${contentType || '(なし)'}\n` +
        `  ${where}\n` +
        '  URL の拡張子ではなく、実際に返ってきた content-type で判断します。',
    );
  }
  if (decision.reason === 'unknown-extension') {
    return new Error(
      `画像の拡張子を判別できませんでした（${context}）: content-type=${contentType || '(なし)'}\n` +
        `  ${where}\n` +
        `  扱えるのは ${Object.keys(MIME_EXTENSIONS).join(' / ')} です。`,
    );
  }
  return new Error(
    `URL の拡張子と content-type が食い違っています（${context}）\n` +
      `  ${where}\n` +
      `  URL の拡張子: ${extensionHint} / content-type: ${contentType}（${decision.mimeExtension}）\n` +
      '  拡張子で配信されるため、どちらへ寄せても壊れた画像になります。',
  );
}

/* --------------------------------------------------------- 検証済みキャッシュ */

/**
 * 検証記録の形式版。**判定の規則を変えたら上げる。**
 * 古い規則で通した記録が、新しい規則を通ったことにならないようにするため。
 */
const CACHE_METADATA_VERSION = 1;

/**
 * 保存済み画像に添える検証記録。`<digest>.json` として画像の隣に置く。
 *
 * **署名やトークンは書かない。** URL のクエリは記録しない（`X-Amz-Signature` /
 * `X-Amz-Security-Token` を成果物として残さないため）。取得元の把握は
 * ビルドログの 1 行が担い、ここは「この成果物は検証を通ったか」だけを持つ。
 */
type CacheMetadata = {
  version: number;
  /** 検証を通した content-type（サブタイプ無しの 'image' もありうる） */
  contentType: string;
  /** 保存したファイルの拡張子 */
  extension: string;
  /** 保存したバイト数。実ファイルとの突き合わせに使う */
  bytes: number;
  /** どの同一性で保存したか。policy を変えた記録を再利用しないため */
  identity: CacheIdentity;
  validatedAt: string;
};

function metadataPath(metadataDir: string, digest: string): string {
  return path.join(metadataDir, `${digest}.json`);
}

/** 壊れた記録・古い記録・知らない形式は「記録なし」として扱う（＝取り直す） */
async function readCacheMetadata(metadataDir: string, digest: string): Promise<CacheMetadata | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metadataPath(metadataDir, digest), 'utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  if (record.version !== CACHE_METADATA_VERSION) return null;
  if (typeof record.contentType !== 'string') return null;
  if (typeof record.extension !== 'string' || !KNOWN_EXTENSIONS.has(record.extension)) return null;
  if (typeof record.bytes !== 'number' || !Number.isInteger(record.bytes) || record.bytes < 0) return null;
  if (record.identity !== 'origin-path' && record.identity !== 'full-url') return null;
  if (typeof record.validatedAt !== 'string') return null;

  return record as CacheMetadata;
}

/**
 * 再利用してよい成果物かを判定する。
 *
 * **ファイルが「ある」ことは再利用の理由にならない。** 以前はここが
 * 「URL から拡張子が読めて、その名前のファイルが存在する」だけで早期 return して
 * おり、このファイルが持つ content-type の検証は 1 つも走らなかった。旧実装が
 * `text/html` の応答を `.svg` として保存していた成果物も、そのまま再利用され続ける
 * 状態だった（実測）。
 *
 * 再利用の条件は 4 つ。1 つでも欠けたら cache miss として取り直す。
 *
 * 1. 検証記録があり、現在の形式版であること（記録の無い旧キャッシュは信用しない）
 * 2. 記録された同一性が、今回求めている同一性と一致すること
 * 3. 実ファイルがあり、記録されたバイト数と一致すること（記録とファイルの不整合で
 *    fail open しない）
 * 4. 記録された content-type を **いまの規則で** 判定し直して、同じ拡張子になること
 *
 * 4 があるので、規則を厳しくした時点で古い成果物は自動的に再取得の対象になる。
 */
async function reusableArtifact(
  outputDir: string,
  metadataDir: string,
  digest: string,
  identity: CacheIdentity,
  extensionHint: string | null,
): Promise<string | null> {
  const metadata = await readCacheMetadata(metadataDir, digest);
  if (metadata === null) return null;
  if (metadata.identity !== identity) return null;

  const fileName = `${digest}${metadata.extension}`;
  const size = await fileSize(path.join(outputDir, fileName));
  if (size === null || size !== metadata.bytes) return null;

  const decision = decideExtension(metadata.contentType, extensionHint);
  if (!decision.ok || decision.extension !== metadata.extension) return null;

  return fileName;
}

/**
 * 画像と検証記録を publish する。
 *
 * どちらも一時ファイルへ書いてから rename する。**画像を先に、記録を後に** 置くのが
 * 要点で、途中で落ちた場合に残るのは「記録の無い画像」——つまり cache miss になる。
 * 逆順にすると「記録はあるが中身が途中までの画像」が残り、それは検証済みを
 * 名乗ってしまう。
 */
async function publishValidatedImage(
  outputDir: string,
  metadataDir: string,
  digest: string,
  fileName: string,
  bytes: Buffer,
  metadata: CacheMetadata,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });
  const unique = randomUUID();

  const imageTmp = path.join(outputDir, `.${fileName}.${unique}.tmp`);
  await writeFile(imageTmp, bytes);
  await rename(imageTmp, path.join(outputDir, fileName));

  const metaTmp = path.join(metadataDir, `.${digest}.json.${unique}.tmp`);
  await writeFile(metaTmp, `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(metaTmp, metadataPath(metadataDir, digest));
}

/**
 * 画像を 1 枚ローカルへ保存し、`/notion-static/<hash>.<ext>` を返す。
 *
 * 検証を通した成果物が既にあれば再取得しない。`context` は失敗時のログ用で、
 * 記事の slug などを渡す。
 */
export async function saveImageLocally(
  url: string,
  context: string,
  options: SaveImageOptions = {},
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 相対パスなどはローカル化の対象外。そのまま通す
    return url;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;

  const identity = options.identity ?? 'full-url';
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const metadataDir = options.metadataDir ?? DEFAULT_METADATA_DIR;
  const extensionHint = extensionFromPath(parsed, context);
  const digest = digestOf(parsed, identity);
  const where = `${parsed.origin}${parsed.pathname}`;

  const reusable = await reusableArtifact(outputDir, metadataDir, digest, identity, extensionHint);
  if (reusable) return `${PUBLIC_PREFIX}/${reusable}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `画像を取得できませんでした（${context}）: ${response.status} ${response.statusText}\n` +
        `  ${where}\n` +
        '  旧ドメインの停止や Notion の署名期限切れが原因のことがあります。',
    );
  }

  // **content-type を必ず見る。** 拡張子は「URL にそう書いてある」だけで、
  // 実際に届いたバイト列の種類ではない
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const decision = decideExtension(contentType, extensionHint);
  if (!decision.ok) throw extensionError(decision, contentType, extensionHint, where, context);

  const bytes = Buffer.from(await response.arrayBuffer());
  const fileName = `${digest}${decision.extension}`;

  await publishValidatedImage(outputDir, metadataDir, digest, fileName, bytes, {
    version: CACHE_METADATA_VERSION,
    contentType,
    extension: decision.extension,
    bytes: bytes.byteLength,
    identity,
    validatedAt: new Date().toISOString(),
  });

  // 外部の画像を自分のサーバーへ複製する行為は、ホットリンクとは権利上の意味が
  // 違う。黙って起きてはいけないので、実際にダウンロードしたときは必ず 1 行残す。
  // URL はクエリを落として出す。Notion の署名付き URL は X-Amz-Signature /
  // X-Amz-Security-Token を含み、これをビルドログへ流すべきではないため。
  console.log(`[images] localized: ${where} → ${PUBLIC_PREFIX}/${fileName} (${context})`);

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

/**
 * 本文 HTML の `<img src>` を、ローカルへ保存した画像へ差し替える。
 *
 * 同一性は既定の `full-url`。legacy 本文の画像は旧ドメインの静的ファイルで、
 * 署名付き URL ではない。クエリ違いを同一視する理由が無く、同一視すると
 * 中身の違う画像を潰す危険だけが残る。
 */
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
