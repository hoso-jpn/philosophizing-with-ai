import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NOTION_VERSION, createNotionApiClient } from './notion-api.ts';

type Call = { url: string; init?: RequestInit };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (next instanceof Response) return next;
    if (next === undefined) throw new Error('unexpected fetch');
    return jsonResponse(next);
  };
  return { calls, fetch };
}

describe('Notion API 2026-03-11 client', () => {
  it('database から単一 data source を発見して新 endpoint を query する', async () => {
    const io = fakeFetch([
      { object: 'database', data_sources: [{ id: 'source-1', name: 'Blog' }] },
      { results: [{ id: 'page-1' }], has_more: false, next_cursor: null },
    ]);
    const client = createNotionApiClient({
      apiKey: 'secret',
      databaseId: 'database-1',
      fetch: io.fetch,
    });

    assert.deepEqual(
      await client.queryDataSource({
        filter: { property: 'Published', checkbox: { equals: true } },
        sorts: [{ property: 'Date', direction: 'ascending' }],
      }),
      [{ id: 'page-1' }],
    );
    assert.deepEqual(
      io.calls.map((call) => call.url),
      [
        'https://api.notion.com/v1/databases/database-1',
        'https://api.notion.com/v1/data_sources/source-1/query',
      ],
    );
    assert.equal(new Headers(io.calls[0].init?.headers).get('Notion-Version'), NOTION_VERSION);
    assert.equal(new Headers(io.calls[1].init?.headers).get('Notion-Version'), NOTION_VERSION);
    assert.deepEqual(JSON.parse(String(io.calls[1].init?.body)), {
      filter: { property: 'Published', checkbox: { equals: true } },
      sorts: [{ property: 'Date', direction: 'ascending' }],
      page_size: 100,
    });
  });

  it('明示 data source ID があれば discovery を行わず、query の全ページを取得する', async () => {
    const io = fakeFetch([
      { results: [{ id: 'page-1' }], has_more: true, next_cursor: 'cursor-2' },
      { results: [{ id: 'page-2' }], has_more: false, next_cursor: null },
    ]);
    const client = createNotionApiClient({
      apiKey: 'secret',
      databaseId: 'database-1',
      dataSourceId: 'source-explicit',
      fetch: io.fetch,
    });

    assert.deepEqual(await client.queryDataSource(), [{ id: 'page-1' }, { id: 'page-2' }]);
    assert.deepEqual(
      io.calls.map((call) => call.url),
      [
        'https://api.notion.com/v1/data_sources/source-explicit/query',
        'https://api.notion.com/v1/data_sources/source-explicit/query',
      ],
    );
    assert.deepEqual(JSON.parse(String(io.calls[1].init?.body)), {
      page_size: 100,
      start_cursor: 'cursor-2',
    });
  });

  it('discovery は client 内で一度だけ行う', async () => {
    const io = fakeFetch([
      { data_sources: [{ id: 'source-1' }] },
      { results: [], has_more: false },
      { results: [], has_more: false },
    ]);
    const client = createNotionApiClient({
      apiKey: 'secret',
      databaseId: 'database-1',
      fetch: io.fetch,
    });

    await client.queryDataSource();
    await client.queryDataSource();
    assert.equal(io.calls.filter((call) => call.url.includes('/databases/')).length, 1);
  });

  it('複数 data source を暗黙選択せず、明示設定を求める', async () => {
    const io = fakeFetch([
      { data_sources: [{ id: 'source-1' }, { id: 'source-2' }] },
    ]);
    const client = createNotionApiClient({
      apiKey: 'secret',
      databaseId: 'database-1',
      fetch: io.fetch,
    });

    await assert.rejects(
      client.queryDataSource(),
      /一意に決められません.*NOTION_DATA_SOURCE_ID/,
    );
    assert.equal(io.calls.length, 1);
  });

  it('壊れた discovery / pagination 応答を途中成功として扱わない', async () => {
    const missingSources = fakeFetch([{ object: 'database' }]);
    await assert.rejects(
      createNotionApiClient({
        apiKey: 'secret', databaseId: 'database-1', fetch: missingSources.fetch,
      }).queryDataSource(),
      /data_sources がありません/,
    );

    const missingCursor = fakeFetch([
      { results: [{ id: 'page-1' }], has_more: true, next_cursor: null },
    ]);
    await assert.rejects(
      createNotionApiClient({
        apiKey: 'secret', databaseId: 'database-1', dataSourceId: 'source-1', fetch: missingCursor.fetch,
      }).queryDataSource(),
      /next_cursor がありません/,
    );

    const repeatedCursor = fakeFetch([
      { results: [], has_more: true, next_cursor: 'same' },
      { results: [], has_more: true, next_cursor: 'same' },
    ]);
    await assert.rejects(
      createNotionApiClient({
        apiKey: 'secret', databaseId: 'database-1', dataSourceId: 'source-1', fetch: repeatedCursor.fetch,
      }).queryDataSource(),
      /next_cursor が繰り返されました/,
    );

    const missingHasMore = fakeFetch([{ results: [] }]);
    await assert.rejects(
      createNotionApiClient({
        apiKey: 'secret', databaseId: 'database-1', dataSourceId: 'source-1', fetch: missingHasMore.fetch,
      }).queryDataSource(),
      /boolean の has_more がありません/,
    );
  });

  it('page retrieve と block children も同じ version header を使う', async () => {
    const io = fakeFetch([{ id: 'page/1' }, { results: [], has_more: false }]);
    const client = createNotionApiClient({
      apiKey: 'secret',
      databaseId: 'database-1',
      fetch: io.fetch,
    });

    await client.retrievePage('page/1');
    await client.retrieveBlockChildren('block/1', 'next cursor');

    assert.deepEqual(
      io.calls.map((call) => call.url),
      [
        'https://api.notion.com/v1/pages/page%2F1',
        'https://api.notion.com/v1/blocks/block%2F1/children?page_size=100&start_cursor=next+cursor',
      ],
    );
    for (const call of io.calls) {
      assert.equal(call.init?.method, 'GET');
      assert.equal(new Headers(call.init?.headers).get('Notion-Version'), NOTION_VERSION);
    }
  });

  it('API error は response detail を含めて fail closed にする', async () => {
    const io = fakeFetch([jsonResponse({ code: 'object_not_found' }, 404)]);
    const client = createNotionApiClient({
      apiKey: 'secret', databaseId: 'database-1', fetch: io.fetch,
    });

    await assert.rejects(client.retrievePage('missing'), /404.*object_not_found/s);
  });
});
