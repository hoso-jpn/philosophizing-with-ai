import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UNKNOWN_EVENT,
  classifyEvent,
  extractPageId,
  summarizeUpdatedProperties,
  wasPublishedPropertyUpdated,
} from './webhook-events.ts';

const pageEvent = (type: string, extra: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type,
  timestamp: '2026-09-03T00:00:00.000Z',
  workspace_id: 'ws-1',
  entity: { id: 'page-1', type: 'page' },
  ...extra,
});

describe('classifyEvent — 検証リクエスト', () => {
  it('verification_token を受けたらビルドを起こさない', () => {
    const action = classifyEvent({ verification_token: 'secret_abc' });
    assert.equal(action.kind, 'verification');
    assert.equal(action.kind === 'verification' && action.token, 'secret_abc');
  });

  it('challenge 形式が来ても受けてビルドを起こさない', () => {
    // Notion の実際の検証は verification_token 方式だが、来ても安全に返す
    const action = classifyEvent({ type: 'url_verification', challenge: 'c-1' });
    assert.equal(action.kind, 'verification');
    assert.equal(action.kind === 'verification' && action.challenge, 'c-1');
  });
});

describe('classifyEvent — ページ単位のイベント', () => {
  it('公開状態しだいのイベントは check-page になる', () => {
    for (const type of [
      'page.created',
      'page.content_updated',
      'page.properties_updated',
      'page.moved',
      'page.deleted',
      'page.undeleted',
    ]) {
      const action = classifyEvent(pageEvent(type));
      assert.equal(action.kind, 'check-page', type);
      assert.equal(action.kind === 'check-page' && action.pageId, 'page-1', type);
    }
  });

  it('ロック状態の変更はスキップする', () => {
    for (const type of ['page.locked', 'page.unlocked']) {
      assert.equal(classifyEvent(pageEvent(type)).kind, 'skip', type);
    }
  });

  it('page イベントで entity.id が取れない場合はビルドへ倒す', () => {
    const action = classifyEvent({ type: 'page.content_updated' });
    assert.equal(action.kind, 'build');
  });
});

describe('classifyEvent — ページIDを持たないイベント', () => {
  it('スキーマ変更は通す（検証を壊しうるのでビルドで確かめる）', () => {
    for (const type of ['data_source.schema_updated', 'database.schema_updated']) {
      const action = classifyEvent({ type, entity: { id: 'ds-1', type: 'data_source' } });
      assert.equal(action.kind, 'build', type);
    }
  });

  it('データソースの content_updated は落とす（page.* と二重になるため）', () => {
    for (const type of ['data_source.content_updated', 'database.content_updated']) {
      const action = classifyEvent({ type, entity: { id: 'ds-1', type: 'data_source' } });
      assert.equal(action.kind, 'skip', type);
    }
  });

  it('データソース自体の出し入れは落とす', () => {
    for (const type of [
      'data_source.created',
      'data_source.moved',
      'data_source.deleted',
      'data_source.undeleted',
    ]) {
      assert.equal(classifyEvent({ type }).kind, 'skip', type);
    }
  });

  it('コメントは落とす', () => {
    for (const type of ['comment.created', 'comment.updated', 'comment.deleted']) {
      assert.equal(classifyEvent({ type }).kind, 'skip', type);
    }
  });
});

describe('classifyEvent — 想定外の入力', () => {
  it('未知の種別は落とす（枠を静かに食い潰さないため）', () => {
    const action = classifyEvent({ type: 'page.something_new' });
    assert.equal(action.kind, 'skip');
    assert.equal(action.kind === 'skip' && action.eventType, 'page.something_new');
  });

  it('種別が無い場合も落とし、ログ用に種別不明と分かる', () => {
    const action = classifyEvent({ entity: { id: 'page-1', type: 'page' } });
    assert.equal(action.kind, 'skip');
    assert.equal(action.kind === 'skip' && action.eventType, UNKNOWN_EVENT);
  });

  it('オブジェクトでないボディは落とす', () => {
    for (const body of [null, undefined, 'text', 42, []]) {
      const action = classifyEvent(body);
      assert.equal(action.kind, 'skip', String(body));
    }
  });
});

describe('extractPageId', () => {
  it('page エンティティから ID を取り出す', () => {
    assert.equal(extractPageId(pageEvent('page.created')), 'page-1');
  });

  it('page 以外のエンティティからは取り出さない', () => {
    assert.equal(extractPageId({ entity: { id: 'ds-1', type: 'data_source' } }), null);
  });

  it('entity が無い・空の場合は null', () => {
    assert.equal(extractPageId({}), null);
    assert.equal(extractPageId({ entity: { type: 'page' } }), null);
    assert.equal(extractPageId({ entity: { id: '', type: 'page' } }), null);
  });
});

describe('wasPublishedPropertyUpdated — 取り下げの取りこぼしを防ぐ', () => {
  const withUpdated = (updated: unknown) => pageEvent('page.properties_updated', { data: { updated_properties: updated } });

  it('プロパティIDの配列で届いた場合に一致させる', () => {
    assert.equal(wasPublishedPropertyUpdated(withUpdated(['%3F%5BOL', 'abc']), '%3F%5BOL'), true);
    assert.equal(wasPublishedPropertyUpdated(withUpdated(['abc']), '%3F%5BOL'), false);
  });

  it('id / name を持つオブジェクトの配列で届いた場合にも一致させる', () => {
    assert.equal(
      wasPublishedPropertyUpdated(withUpdated([{ id: '%3F%5BOL', name: 'Published' }]), '%3F%5BOL'),
      true,
    );
    assert.equal(
      wasPublishedPropertyUpdated(withUpdated([{ id: 'zzz', name: 'Tags' }]), '%3F%5BOL'),
      false,
    );
  });

  it('プロパティIDが分からなくても名前で一致させる', () => {
    assert.equal(wasPublishedPropertyUpdated(withUpdated(['Published']), null), true);
    assert.equal(wasPublishedPropertyUpdated(withUpdated([{ name: 'Published' }]), null), true);
    assert.equal(wasPublishedPropertyUpdated(withUpdated([{ name: 'Content' }]), null), false);
  });

  it('本文プロパティだけの更新は Published の変更とみなさない', () => {
    assert.equal(
      wasPublishedPropertyUpdated(withUpdated([{ id: 'ct01', name: 'Content' }]), '%3F%5BOL'),
      false,
    );
  });

  it('updated_properties が無ければ判断できない（null）', () => {
    assert.equal(wasPublishedPropertyUpdated(pageEvent('page.properties_updated'), 'x'), null);
    assert.equal(wasPublishedPropertyUpdated(withUpdated('not-an-array'), 'x'), null);
    assert.equal(wasPublishedPropertyUpdated(null, 'x'), null);
  });
});

describe('summarizeUpdatedProperties — 初回イベントでの突き合わせ用', () => {
  const withUpdated = (updated: unknown) =>
    pageEvent('page.properties_updated', { data: { updated_properties: updated } });

  it('実ペイロード（プロパティIDの配列）をそのまま並べる', () => {
    // 公式サンプルの形: "updated_properties": ["XGe%40", "bDf%5B", "DbAu"]
    assert.equal(
      summarizeUpdatedProperties(withUpdated(['XGe%40', 'bDf%5B', 'DbAu'])),
      'XGe%40,bDf%5B,DbAu',
    );
  });

  it('オブジェクト形式なら名前も添える', () => {
    assert.equal(
      summarizeUpdatedProperties(withUpdated([{ id: 'XGe%40', name: 'Published' }])),
      'XGe%40:Published',
    );
  });

  it('無い・空・非配列を区別できる', () => {
    assert.equal(summarizeUpdatedProperties(pageEvent('page.properties_updated')), '(none)');
    assert.equal(summarizeUpdatedProperties(withUpdated([])), '(empty)');
    assert.equal(summarizeUpdatedProperties(withUpdated('x')), '(none)');
    assert.equal(summarizeUpdatedProperties(null), '(none)');
  });
});
