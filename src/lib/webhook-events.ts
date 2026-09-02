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
 * page.deleted も含める。公開済みの記事がゴミ箱へ入るとサイトから消す必要があり、
 * Notion はゴミ箱のページも取得できる（in_trash: true）ので Published を読める。
 * 下書きの削除なら Published が false なのでスキップに落ちる。
 */
const PAGE_EVENTS_NEEDING_PUBLISH_CHECK = new Set([
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
]);

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
 * そのイベントで Published プロパティ自体が変更されたか。
 *
 * 用途は「非公開化の取りこぼし」を防ぐこと。Published を true→false にすると
 * ページは非公開になるので、現在値だけを見るとスキップしてしまい、記事がサイトに
 * 残り続ける。data.updated_properties に Published が含まれていれば、現在値が
 * false でもビルドする。
 *
 * updated_properties の要素は、資料によって「プロパティIDの文字列」とも
 * 「id/name を持つオブジェクト」とも書かれている。実ペイロードを見るまで
 * 確定できないので両方を受け、ID と名前のどちらでも一致させる。
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
      return entry === publishedPropertyId || entry === 'Published';
    }
    const item = asRecord(entry);
    if (!item) return false;
    return (
      (publishedPropertyId !== null && item.id === publishedPropertyId) || item.name === 'Published'
    );
  });
}

/**
 * updated_properties をログ 1 行に収まる形へ畳む。
 *
 * page.properties_updated の updated_properties は「プロパティIDの文字列の配列」
 * （例: ["XGe%40","bDf%5B"]）で届く。一方こちらが持つ Published のプロパティIDは
 * REST API（Notion-Version 2022-06-28）から読んだ値で、webhook 側のバージョンとは
 * 別系統。両者の表記が一致することは実イベントで一度確認しておきたいので、
 * 突き合わせの材料をそのままログへ出す。
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
