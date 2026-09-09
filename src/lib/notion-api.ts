/**
 * Notion REST API の薄い client。
 *
 * 2025-09-03 で database は複数 data source の container になり、行の query は
 * data source endpoint へ移った。呼び出し側へその差分を漏らさず、API version と
 * data source 解決をこのファイルへ集約する。
 */

export const NOTION_VERSION = '2026-03-11';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type NotionApiConfig = {
  apiKey: string;
  /** Notion UI の database URL に含まれる container ID */
  databaseId: string;
  /** 複数 source を使う場合に明示する。単一 source なら database から自動解決する */
  dataSourceId?: string | null;
  /** unit test 用 */
  fetch?: FetchLike;
};

export type QueryDataSourceOptions = {
  filter?: unknown;
  sorts?: unknown;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseSingleDataSourceId(databaseId: string, payload: unknown): string {
  const record = asRecord(payload);
  const sources = record?.data_sources;
  if (!Array.isArray(sources)) {
    throw new Error(
      `Notion database ${databaseId} の応答に data_sources がありません。` +
        `Notion-Version ${NOTION_VERSION} の応答形を確認してください。`,
    );
  }

  const ids = sources.map((source) => nonEmptyString(asRecord(source)?.id)).filter(Boolean) as string[];
  if (ids.length === 0) {
    throw new Error(`Notion database ${databaseId} に query できる data source がありません。`);
  }
  if (ids.length !== 1 || ids.length !== sources.length) {
    throw new Error(
      `Notion database ${databaseId} の data source を一意に決められません（${sources.length} 件）。` +
        `環境変数 NOTION_DATA_SOURCE_ID で対象を明示してください。`,
    );
  }
  return ids[0];
}

/**
 * 1 プロセスにつき 1 client を作る。database → data source の discovery は Promise を
 * メモ化し、query のページネーションや複数の getPosts 呼び出しで重複させない。
 */
export function createNotionApiClient(config: NotionApiConfig) {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const explicitDataSourceId = nonEmptyString(config.dataSourceId);
  let discoveredDataSourceId: Promise<string> | null = null;

  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`https://api.notion.com/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Notion API への ${path} が失敗しました: ${response.status} ${response.statusText}\n` +
          detail.slice(0, 500),
      );
    }
    return response.json();
  }

  async function discoverDataSourceId(): Promise<string> {
    const databaseId = nonEmptyString(config.databaseId);
    if (!databaseId) throw new Error('Notion database ID が空です。');
    const payload = await request(`databases/${encodeURIComponent(databaseId)}`);
    return parseSingleDataSourceId(databaseId, payload);
  }

  function resolveDataSourceId(): Promise<string> {
    if (explicitDataSourceId) return Promise.resolve(explicitDataSourceId);
    discoveredDataSourceId ??= discoverDataSourceId();
    return discoveredDataSourceId;
  }

  async function queryDataSource(options: QueryDataSourceOptions = {}): Promise<unknown[]> {
    const dataSourceId = await resolveDataSourceId();
    const results: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    do {
      const payload = asRecord(
        await request(`data_sources/${encodeURIComponent(dataSourceId)}/query`, {
          filter: options.filter,
          sorts: options.sorts,
          page_size: 100,
          start_cursor: cursor,
        }),
      );

      if (!payload || !Array.isArray(payload.results)) {
        throw new Error('Notion data source query の応答に results 配列がありません。');
      }
      if (typeof payload.has_more !== 'boolean') {
        throw new Error('Notion data source query の応答に boolean の has_more がありません。');
      }
      results.push(...payload.results);

      if (payload.has_more) {
        const next = nonEmptyString(payload.next_cursor);
        if (!next) {
          throw new Error(
            'Notion data source query が has_more=true を返しましたが next_cursor がありません。',
          );
        }
        if (seenCursors.has(next)) {
          throw new Error(`Notion data source query の next_cursor が繰り返されました（${next}）。`);
        }
        seenCursors.add(next);
        cursor = next;
      } else {
        cursor = undefined;
      }

      if (++pages > 200) {
        throw new Error('Notion data source query のページネーションが 200 ページを超えました。');
      }
    } while (cursor);

    return results;
  }

  function retrievePage(pageId: string): Promise<unknown> {
    return request(`pages/${encodeURIComponent(pageId)}`);
  }

  function retrieveBlockChildren(blockId: string, cursor: string | null): Promise<unknown> {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    return request(`blocks/${encodeURIComponent(blockId)}/children?${query}`);
  }

  return { queryDataSource, retrievePage, retrieveBlockChildren };
}
