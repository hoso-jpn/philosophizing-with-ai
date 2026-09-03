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
const SELF_HOSTS = ['blog.florigen.ai', 'philosophizing-with-ai.com'];

/** プレビューデプロイのホストは毎回変わるので、サフィックスで見る */
const SELF_HOST_SUFFIXES = ['.vercel.app'];

/** 停止済みで復元もできないホスト。エラー文で補足するために持つ */
const DEAD_HOSTS = ['philosophizing-with-ai.com'];

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
