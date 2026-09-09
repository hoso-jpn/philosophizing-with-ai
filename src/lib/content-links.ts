/**
 * 本文（Content プロパティ）中の URL に関する検査。
 *
 * 発端は「`philosophizing-with-ai.com` という特定の文字列を探す」検査を書いたこと。
 * それでは旧プレビューホスト `philosophizing-with-ai.vercel.app` への参照 1 本を
 * 取りこぼした（2026-09-03 発見）。禁止リストは必ず漏れる。
 *
 * さらに、検査対象を Notion の本文だけにしていたため、`src/pages/about.astro` に
 * 4 か月以上放置されていた `/posts/<Notion の UUID>` リンク 3 本も取りこぼした
 * （同日発見・本番でも 404 だった）。**同じ規則を本文とテンプレートの両方へ適用する。**
 *
 * そこで 2 段構えにしてある。
 *
 * 1. **規則で止める**: 公開記事の本文に「自サイトを指す絶対 URL」があればビルドを止める。
 *    内部リンクは相対パスでなければならない、という不変条件。
 * 2. **一覧で気づく**: 本文中の全 URL のホストを集計してビルドログへ出す。
 *    規則は漏れるが、一覧は漏れない。想定外のホストが混ざれば目視で気づける。
 */

/**
 * 自サイトを指すホスト。現行・旧・プレビューを含む。
 *
 * `blog.florigen.ai`（現行ドメイン）も対象に入れるのが要点。自サイトへの絶対 URL は
 * 常にバグで、(a) プレビューデプロイで踏むと本番へ飛んでしまいプレビューの意味が
 * なくなる、(b) ドメインを変えたときに全部壊れる（実際に起きた）。
 */
const SELF_HOSTS = ['blog.florigen.ai', 'philosophizing-with-ai.com', 'app.notion.com', 'notion.so'];

/**
 * プレビューデプロイのホストは毎回変わるので、サフィックスで見る。
 *
 * `notion.so` も同様。Notion のページメンションは `https://www.notion.so/...` と
 * いう href になり、`app.notion.com` と同じく **読者が開けないリンク**である。
 * サブドメインが増えても取りこぼさないようサフィックスで判定する（D-43）。
 */
const SELF_HOST_SUFFIXES = ['.vercel.app', '.notion.so'];

/** 停止済みで復元もできないホスト。エラー文で補足するために持つ */
const DEAD_HOSTS = ['philosophizing-with-ai.com'];

/**
 * Notion がリンクを書き換えて残すホスト。
 *
 * Notion の rich_text プロパティに `[label](/posts/slug)` と書くと、Notion は
 * href を `https://app.notion.com/posts/slug` という絶対 URL へ変換して保存する。
 * そのまま出力すると、読者は Notion のアプリドメインへ飛ばされて 404 になる。
 * パイプラインで書き換えず（D-14）、ここで止めて Notion 側を直してもらう。
 */
const NOTION_APP_HOST = 'app.notion.com';

export type UrlReference = {
  /** 'link' = <a href> / 'image' = <img src> */
  kind: 'link' | 'image';
  /** 見つかったタグ（Notion 上で検索・置換するときの手掛かり） */
  tag: string;
  url: string;
  host: string;
};

const TAG_PATTERNS: { kind: UrlReference['kind']; pattern: RegExp }[] = [
  { kind: 'link', pattern: /<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi },
  { kind: 'image', pattern: /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi },
];

/** 長いタグはログが読めなくなるので丸める */
const MAX_TAG_LENGTH = 160;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null; // 相対パス・data: など。絶対 URL ではないので対象外
  }
}

export function isSelfHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    SELF_HOSTS.includes(normalized) ||
    SELF_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

/** `<a href>` と `<img src>` のうち、自サイトを指す絶対 URL を集める */
export function findSelfReferencingUrls(content: string): UrlReference[] {
  const found: UrlReference[] = [];

  for (const { kind, pattern } of TAG_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const host = hostOf(match[1]);
      if (host === null || !isSelfHost(host)) continue;
      const tag = match[0].length > MAX_TAG_LENGTH ? `${match[0].slice(0, MAX_TAG_LENGTH)}…` : match[0];
      found.push({ kind, tag, url: match[1], host });
    }
  }
  return found;
}

/**
 * `/posts/<Notion のページ ID>` 形式。Notion 移行前の URL がそのまま残ったもの。
 * slug は英小文字とハイフンなので、UUID 形式と取り違える余地はない。
 */
const NOTION_ID_PATH = /^\/posts\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\/?$/i;

/** `/posts/<UUID>` を指しているリンク・画像を集める */
export function findNotionIdPaths(source: string): UrlReference[] {
  const found: UrlReference[] = [];
  for (const { kind, pattern } of TAG_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (!NOTION_ID_PATH.test(match[1])) continue;
      const tag = match[0].length > MAX_TAG_LENGTH ? `${match[0].slice(0, MAX_TAG_LENGTH)}…` : match[0];
      found.push({ kind, tag, url: match[1], host: '(サイト内)' });
    }
  }
  return found;
}

export class SelfReferencingUrlError extends Error {
  constructor(offenders: { slug: string; references: UrlReference[] }[]) {
    const total = offenders.reduce((n, o) => n + o.references.length, 0);
    const hitsDeadHost = offenders.some((o) => o.references.some((r) => DEAD_HOSTS.includes(r.host)));

    super(
      `自サイトへの絶対 URL、または Notion のページ ID を指す URL があります` +
        `（${offenders.length} 箇所・計 ${total} 件）。\n\n` +
        offenders
          .map(
            (o) =>
              `[content] ${o.slug}: ${
                o.references.every((r) => r.host === '(サイト内)')
                  ? 'Notion のページ ID を指す URL が含まれています'
                  : '自サイトへの絶対URL / Notion のページ ID を指す URL が含まれています'
              }\n` +
              o.references
                .map(
                  (r) =>
                    `  ${r.tag}\n` +
                    (r.host === '(サイト内)'
                      ? '  → Notion のページ ID ではなく slug で書いてください（/posts/<slug>）'
                      : r.host === NOTION_APP_HOST
                        ? '  → Notion がリンクを絶対 URL へ書き換えています。Notion 側で ' +
                          '/posts/<slug> の相対リンクに直してください'
                        : r.kind === 'link'
                          ? '  → 相対パス（/posts/<slug>）に書き換えてください'
                          : '  → public/images/ に置いて /images/<file> で参照してください'),
                )
                .join('\n'),
          )
          .join('\n\n') +
        '\n\n' +
        '内部リンクは相対パスでなければなりません。絶対 URL はドメインを変えたときに\n' +
        'すべて壊れ、プレビューデプロイで踏むと本番へ飛んでしまいます。\n' +
        (hitsDeadHost
          ? `\n${DEAD_HOSTS.join(' / ')} は停止済みで、画像は復元できません。` +
            '\n図は作り直すか、figure ごと削除してください。\n'
          : ''),
    );
    this.name = 'SelfReferencingUrlError';
  }
}

/**
 * 自サイトへの絶対 URL と `/posts/<UUID>` があればビルドを止める。
 *
 * **Notion の本文と Astro テンプレートの両方に同じ規則を当てる。**
 * 本文だけを見ていたために about.astro の壊れたリンク 3 本を 4 か月見逃した。
 *
 * 1 件ずつ投げず全件まとめて検査する。1 件ずつ落とすと
 * 「直す → ビルド → 次が見つかる」を参照の数だけ繰り返すことになるため。
 *
 * 本文側の対象は **公開記事だけ**。下書きは getPosts の Published フィルタで
 * そもそも取得されないので、ここへは渡ってこない。
 */
export function assertNoSelfReferencingUrls(entries: { slug: string; content: string }[]): void {
  const offenders = entries
    .map((entry) => ({
      slug: entry.slug,
      references: [...findSelfReferencingUrls(entry.content), ...findNotionIdPaths(entry.content)],
    }))
    .filter((entry) => entry.references.length > 0);

  if (offenders.length > 0) throw new SelfReferencingUrlError(offenders);
}

/**
 * 本文中の全 URL のホストを数える。
 *
 * タグの種類を問わず `https?://` を拾う。禁止リスト方式は今回のように漏れるが、
 * 一覧は漏れない。想定外のホストが増えたことに目視で気づくための仕組み。
 */
export function countReferencedHosts(posts: { content: string }[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const post of posts) {
    for (const match of post.content.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
      const host = hostOf(match[0]);
      if (host === null) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return counts;
}

/** 参照ホスト一覧を件数の多い順（同数ならホスト名順）に整形する */
export function formatReferencedHosts(counts: Map<string, number>): string[] {
  return [...counts]
    .sort(([hostA, countA], [hostB, countB]) => countB - countA || hostA.localeCompare(hostB))
    .map(([host, count]) => `  ${String(count).padStart(3)}  ${host}`);
}

/**
 * リンクとして出してよいスキームだけを通す。
 *
 * D-19 のとおり URL の規則はこのファイルに集約する。ページ本文の renderer が
 * 独自のスキーム判定を持つと、規則が 2 か所に分かれて必ず食い違う。
 *
 * ここが見るのは **スキームの安全性だけ**。自サイトへの絶対 URL の検出
 * （assertNoSelfReferencingUrls）は Notion のページ本文に対してはまだ動いておらず、
 * それは Issue #6 の担当。ここでその一部を先取りすると、#6 の検査が
 * 「もう半分やってある」状態になって取りこぼす。
 *
 * 相対パス（/posts/<slug>、#anchor、?query）はそのまま通す。内部リンクは
 * 相対パスで書く決まりなので、これを弾くと正しい書き方が使えなくなる。
 */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * @returns 出力してよい href。危険なら null（呼び出し側はリンクにしない）
 */
export function safeHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;

  const trimmed = href.trim();
  if (trimmed === '') return null;

  // 制御文字を含む URL は受け取らない。
  //
  // ブラウザは URL を解釈する前にタブ・改行・復帰を取り除くので、
  // `java&#9;script:alert(1)` は `javascript:alert(1)` として実行される。
  // 一方こちらのスキーム判定は素直に読むと「スキーム無し＝相対パス」と見なして
  // そのまま通してしまう。正常な URL に生の制御文字は現れないので、丸ごと弾く。
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  // 相対 URL。スキームを持たないので javascript: 等にはなりえない。
  // ベースは判定のためだけのもので、戻り値には使わない
  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://example.invalid/');
  } catch {
    return null; // URL として解釈できないものは出さない
  }

  // 相対のまま書かれていた場合は、書かれたとおりに返す（絶対化しない）
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (!hasScheme) return trimmed;

  return SAFE_URL_SCHEMES.has(parsed.protocol) ? trimmed : null;
}

/* ------------------------------------------- URL 単位の規則（ページ本文用） */

/**
 * サイトの正規オリジン。`//host` や `\\host` をブラウザと同じ意味で解決するために使う。
 */
const SITE_ORIGIN = 'https://blog.florigen.ai';

/**
 * 「ホストを指定している書き方」か。
 *
 * スキーム付きの絶対 URL に加えて、**protocol-relative（`//host/...`）と
 * バックスラッシュ形（`\\host/...`）も含む**。後ろ 2 つはスキームを持たないので
 * 素朴に見ると相対パスに見えるが、ブラウザは別オリジンへ解決する（実測）。
 * 相対パスとして扱うと、自サイト参照の監査を丸ごとすり抜ける。
 */
function designatesHost(raw: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true;
  // `//host` `\\host` `/\host` `\/host` はいずれも authority の書き出しになる
  return /^[\\/]{2}/.test(raw);
}

/** スキームを持たず、`//` でも始まらない書き方（`/posts/x`、`#a`、`?q=1`、`a/b`） */
function isPlainRelative(raw: string): boolean {
  return !designatesHost(raw);
}

export type UrlPolicyViolation = {
  url: string;
  /** 機械判定の理由。テストと診断の両方で使う */
  reason: 'self-host' | 'notion-id-path' | 'authority-shorthand';
  /** 読み手に何を直せばよいかを伝える 1 行 */
  advice: string;
};

/**
 * URL 1 本を本文へ書いてよいか判定する。
 *
 * **HTML ではなく URL 文字列を見る規則。** 既存の findSelfReferencingUrls は
 * legacy 本文（HTML 文字列）を正規表現で走査するもので、型付きのページ本文には
 * 使えない。規則そのものはここに 1 本化し、両方から呼べるようにする（D-19）。
 *
 * `safeHref` とは責務が違う。あちらは `javascript:` などを弾く **スキームの安全性**
 * （XSS 対策）で、こちらは **内部リンクの正規形**（D-13）。片方に混ぜない。
 *
 * @returns 問題があればその内容、無ければ null
 */
export function findUrlPolicyViolation(raw: string): UrlPolicyViolation | null {
  const url = raw.trim();
  if (url === '') return null;

  if (isPlainRelative(url)) {
    // 相対パスは正しい書き方。ただし Notion のページ ID を指していないかは見る
    return NOTION_ID_PATH.test(url)
      ? {
          url,
          reason: 'notion-id-path',
          advice: 'Notion のページ ID ではなく slug で書いてください（/posts/<slug>）',
        }
      : null;
  }

  // `//host/...` と `\\host/...` は、自サイト・外部にかかわらず本文では使わない。
  // ブラウザ依存の解釈に頼る書き方で、スキームを固定できず、監査もすり抜けやすい
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return {
      url,
      reason: 'authority-shorthand',
      advice:
        'スキームを省いた `//host/...` や `\\host/...` は使わないでください。' +
        'サイト内なら相対パス（/posts/<slug>）、外部なら https:// から書いてください',
    };
  }

  let host: string;
  try {
    host = new URL(url, SITE_ORIGIN).hostname.toLowerCase();
  } catch {
    return null; // mailto: など、ホストを持たない絶対 URL は対象外
  }

  if (!isSelfHost(host)) return null;

  return {
    url,
    reason: 'self-host',
    advice: host.endsWith('notion.so') || host === NOTION_APP_HOST
      ? 'Notion 内部のリンクです。読者は開けません。Notion 側で /posts/<slug> の相対リンクに直してください'
      : '自サイトへの絶対 URL です。相対パス（/posts/<slug>）に書き換えてください',
  };
}

/* --------------------------------------------------- 診断へ URL を載せるとき */

/**
 * URL を診断・ログへ載せられる形へ落とす。
 *
 * **画像の取得元 URL には署名や資格情報が乗る。** Notion がホストする画像は
 * `X-Amz-Signature` / `X-Amz-Credential` / `X-Amz-Security-Token` を、外部の
 * 画像配信も `token=` や `Authorization=` をクエリに持つことがある。診断へ生の
 * URL を書くと、ビルドログという公開されうる場所へそれが流れる。
 *
 * どこから取ろうとしたかは origin + pathname で十分に分かるので、クエリと
 * フラグメントは落とす。**規則を 2 か所に書かない**（D-19）ため、URL の扱いは
 * このファイルに集約し、article-media.ts と article-links.ts の双方から使う。
 */
export function safeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(URL として解釈できない値)';
  }
}
