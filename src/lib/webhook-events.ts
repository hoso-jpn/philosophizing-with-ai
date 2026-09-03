/**
 * Notion webhook のイベントを「ビルドを起こすか」に振り分ける純粋関数群。
 *
 * Vercel Hobby はデプロイ 100 回/日・同時ビルド 1 本・デプロイフック 60 回/時。
 * 受信イベントを無条件でビルドに流すと、執筆中の自動保存だけでキューが埋まる。
 * ここで「サイトの出力が変わらないイベント」を落とす。
 *
 * I/O はしない。Notion API を叩く判断（check-page）は呼び出し側に返す。
 */

/** イベント種別が分からない場合にログへ出す表示名 */
export const UNKNOWN_EVENT = '(type 不明)';

export type WebhookAction =
  /** サブスクリプション作成時の疎通確認。ビルドしない */
  | { kind: 'verification'; token: string | null; challenge: string | null }
  /** 対象ページの Published を見てから決める */
  | { kind: 'check-page'; eventType: string; pageId: string }
  /** ページを見るまでもなくビルドする */
  | { kind: 'build'; eventType: string; reason: string }
  /** ビルドしない */
  | { kind: 'skip'; eventType: string; reason: string };

/**
 * ページ単位のイベントのうち、公開状態しだいでサイトの出力が変わるもの。
 *
 * これらはイベント発生後も対象ページを普通に取得できる前提で Published を確認する。
 */
const PAGE_EVENTS_NEEDING_PUBLISH_CHECK = new Set([
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
]);

/**
 * ページ状態を取り直さず、常にビルドするイベント。
 *
 * page.deleted はイベント到着時点でページが Trash に入っている。削除後のページを REST API
 * で取得できることに依存すると、公開記事を消したのに再ビルドできずサイトへ残る経路ができる。
 * page.undeleted も対になる低頻度イベントなので、下書きの復元で 1 回余分にビルドするより
 * 「復元した公開記事が戻らない」可能性を消す方を優先する。
 */
const PAGE_EVENTS_ALWAYS_BUILD = new Set(['page.deleted', 'page.undeleted']);

/** ページ単位だが、サイトの出力には影響しないもの */
const PAGE_EVENTS_WITHOUT_OUTPUT_CHANGE = new Set(['page.locked', 'page.unlocked']);

/**
 * ページIDを持たないイベントのうち、通すもの。
 *
 * スキーマ変更（プロパティ名・型の変更）は src/lib/notion-schema.ts の検証を壊す。
 * 壊れたことは「次に誰かが記事を書いたとき」ではなく、変更した直後に知りたい。
 * ビルドが失敗しても直前の成功デプロイが稼働し続ける（Vercel はビルド成功時にだけ
 * 本番エイリアスを張り替える）ので、通して落とすのが最も早く気づける。
 * 人手のスキーマ変更は頻度が低く、100回/日の枠を圧迫しない。
 */
const SCHEMA_EVENTS = new Set(['data_source.schema_updated', 'database.schema_updated']);

/**
 * ページIDを持たないイベントのうち、落とすもの。
 *
 * *.content_updated はデータソース全体の行の増減で発火する。同じ変更は
 * page.created / page.deleted でも届くため二重になる。ここを通すと
 * 「下書きを1行足しただけ」でもビルドが走り、フィルタの意味が無くなる。
 * *.created / *.moved / *.deleted / *.undeleted はデータソース自体の
 * 出し入れで、記事の内容は変わらない（消えていれば次のビルドが失敗して気づく）。
 */
const DATA_SOURCE_EVENTS_TO_SKIP = new Set([
  'data_source.created',
  'data_source.content_updated',
  'data_source.moved',
  'data_source.deleted',
  'data_source.undeleted',
  'database.created',
  'database.content_updated',
  'database.moved',
  'database.deleted',
  'database.undeleted',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Notion のサブスクリプション検証リクエストか判定する。
 *
 * Notion は購読を作った直後に {"verification_token": "..."} を 1 度だけ POST し、
 * その値を Notion の画面へ貼り戻すことで検証が完了する。
 * Slack 型の {"type":"url_verification","challenge":"..."} ではない。
 * ただし challenge が来ても安全に返せるよう、両方を受けてビルドは起こさない。
 */
function detectVerification(body: Record<string, unknown>): WebhookAction | null {
  const token = asNonEmptyString(body.verification_token);
  const challenge = asNonEmptyString(body.challenge);
  if (!token && !challenge) return null;
  return { kind: 'verification', token, challenge };
}

/** page.* イベントから対象ページの ID を取り出す。取れなければ null */
export function extractPageId(body: unknown): string | null {
  const entity = asRecord(asRecord(body)?.entity);
  if (!entity) return null;
  if (entity.type !== undefined && entity.type !== 'page') return null;
  return asNonEmptyString(entity.id);
}

/**
 * 受信したイベントを振り分ける。
 *
 * 未知の種別はスキップに倒す。通す側に倒すと、Notion がイベント種別を増やした
 * 時点で 100 回/日の枠を静かに食い潰すため。スキップは必ずログへ 1 行残るので、
 * 取りこぼしていることには気づける。
 */
export function classifyEvent(body: unknown): WebhookAction {
  const record = asRecord(body);
  if (!record) {
    return { kind: 'skip', eventType: UNKNOWN_EVENT, reason: 'ボディが JSON オブジェクトではない' };
  }

  const verification = detectVerification(record);
  if (verification) return verification;

  const eventType = asNonEmptyString(record.type) ?? UNKNOWN_EVENT;

  if (SCHEMA_EVENTS.has(eventType)) {
    return {
      kind: 'build',
      eventType,
      reason: 'スキーマ変更は notion-schema.ts の検証を壊しうるため、ビルドで確かめる',
    };
  }

  if (PAGE_EVENTS_ALWAYS_BUILD.has(eventType)) {
    return {
      kind: 'build',
      eventType,
      reason: '削除・復元は低頻度で、変更後ページの再取得に依存せずサイトへ反映する',
    };
  }

  if (PAGE_EVENTS_WITHOUT_OUTPUT_CHANGE.has(eventType)) {
    return { kind: 'skip', eventType, reason: 'ロック状態の変更はサイトの出力に影響しない' };
  }

  if (DATA_SOURCE_EVENTS_TO_SKIP.has(eventType)) {
    return { kind: 'skip', eventType, reason: 'ページ単位のイベントで同じ変更が届くため二重' };
  }

  if (eventType.startsWith('comment.')) {
    return { kind: 'skip', eventType, reason: 'コメントはサイトに出力していない' };
  }

  if (PAGE_EVENTS_NEEDING_PUBLISH_CHECK.has(eventType)) {
    const pageId = extractPageId(record);
    if (!pageId) {
      // 種別は page.* なのに entity.id が無いのは想定外。ページを見に行けない以上、
      // 公開記事の変更を取りこぼす方が痛いのでビルドへ倒す（頻度は 0 のはず）。
      return { kind: 'build', eventType, reason: 'page イベントだが entity.id が取れなかった' };
    }
    return { kind: 'check-page', eventType, pageId };
  }

  return { kind: 'skip', eventType, reason: '購読対象外の種別' };
}

/**
 * property ID の URL エンコード表記を吸収する。
 *
 * webhook の updated_properties は `XGe%40` のような percent-encoded ID を返す一方、
 * REST API で取得したプロパティ ID の表記が同じとは限らない。比較時だけ decode して
 * `XGe%40` と `XGe@` を同一視する。壊れた percent encoding はそのまま比較する。
 */
function normalizePropertyId(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function samePropertyId(left: unknown, right: unknown): boolean {
  const a = normalizePropertyId(left);
  const b = normalizePropertyId(right);
  return a !== null && b !== null && a === b;
}

/**
 * そのイベントで Published プロパティ自体が変更されたか。
 *
 * 用途は「非公開化の取りこぼし」を防ぐこと。Published を true→false にすると
 * ページは非公開になるので、現在値だけを見るとスキップしてしまい、記事がサイトに
 * 残り続ける。data.updated_properties に Published が含まれていれば、現在値が
 * false でもビルドする。
 *
 * updated_properties は現行仕様ではプロパティIDの文字列配列。過去の検証コードとの
 * 互換のため id/name を持つオブジェクトも受ける。ID は URL エンコード差を正規化して
 * 比較するので、webhook と REST API の表記差に依存しない。
 *
 * @param publishedPropertyId 取得したページから読んだ Published プロパティの ID
 * @returns true=変更された / false=変更されていない / null=判断できない
 */
export function wasPublishedPropertyUpdated(
  body: unknown,
  publishedPropertyId: string | null,
): boolean | null {
  const updated = asRecord(asRecord(body)?.data)?.updated_properties;
  if (!Array.isArray(updated)) return null;

  return updated.some((entry) => {
    if (typeof entry === 'string') {
      return entry === 'Published' || samePropertyId(entry, publishedPropertyId);
    }
    const item = asRecord(entry);
    if (!item) return false;
    return item.name === 'Published' || samePropertyId(item.id, publishedPropertyId);
  });
}

/**
 * updated_properties をログ 1 行に収まる形へ畳む。
 * 初回の実イベントでも観測可能性を残すため、受信した表記をそのまま出す。
 */
export function summarizeUpdatedProperties(body: unknown): string {
  const updated = asRecord(asRecord(body)?.data)?.updated_properties;
  if (!Array.isArray(updated)) return '(none)';
  if (updated.length === 0) return '(empty)';

  return updated
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      const item = asRecord(entry);
      if (!item) return '?';
      return typeof item.name === 'string' ? `${item.id}:${item.name}` : String(item.id ?? '?');
    })
    .join(',');
}
