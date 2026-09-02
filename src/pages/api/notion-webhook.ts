// src/pages/api/notion-webhook.ts
import type { APIRoute } from 'astro';

import { getPagePublishState } from '../../lib/notion.ts';
import {
  classifyEvent,
  summarizeUpdatedProperties,
  wasPublishedPropertyUpdated,
  type WebhookAction,
} from '../../lib/webhook-events.ts';

/**
 * Notion の更新を受けて Vercel のデプロイフックを叩く。
 *
 * Vercel Hobby はデプロイ 100 回/日・同時ビルド 1 本・デプロイフック 60 回/時。
 * 以前はイベントを一切見ずに毎回ビルドを起こしていたため、執筆中の自動保存だけで
 * 枠を使い切り、同時ビルド 1 本のキューが詰まる。振り分けは webhook-events.ts、
 * 公開状態の確認は notion.ts の getPagePublishState が持つ。
 *
 * 応答は原則 200。Notion は 200 以外だと最大 8 回・約 24 時間リトライするため、
 * 「ビルドしないと決めた」ことをリトライで蒸し返させない。
 * 200 を返さないのは、リトライで直る見込みがある障害（Notion API / デプロイフック）だけ。
 */

// SSG 化後もこのルートだけはサーバ上で動かす必要がある
export const prerender = false;

const log = (message: string) => console.log(`[webhook] ${message}`);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** デプロイフックを叩く */
async function triggerBuild(): Promise<Response> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    console.error('[webhook] VERCEL_DEPLOY_HOOK_URL が設定されていません');
    return json(500, { error: 'Server configuration error' });
  }

  const response = await fetch(hookUrl, { method: 'POST' });
  if (!response.ok) {
    // 429 ならデプロイフックの 60 回/時 上限。ここに来るならフィルタが緩すぎる
    const detail = await response.text().catch(() => '');
    console.error(`[webhook] deploy hook failed: ${response.status} ${detail.slice(0, 200)}`);
    return json(500, { error: 'Deploy hook failed' });
  }
  return json(200, { message: 'build triggered' });
}

/**
 * Published を見てビルドするか決める。
 *
 * 現在値が false でも、そのイベントで Published 自体が変更されていればビルドする。
 * 公開 → 非公開（取り下げ）も現在値は false になるため、現在値だけで切ると
 * 取り下げたはずの記事がサイトに残り続ける。
 */
async function decideByPublishState(
  action: Extract<WebhookAction, { kind: 'check-page' }>,
  body: unknown,
): Promise<Response> {
  const state = await getPagePublishState(action.pageId);

  // properties_updated だけは、Published の突き合わせ材料をログへ添える。
  // webhook 側（購読の API バージョン）が返すプロパティIDと、REST API
  // （Notion-Version 2022-06-28）から読んだ Published のIDが同じ表記かは
  // 実イベントを一度見るまで確定できないため、初回で確認できるようにしておく。
  const detail =
    action.eventType === 'page.properties_updated'
      ? ` [published_prop=${state.publishedPropertyId ?? 'unknown'} updated=${summarizeUpdatedProperties(body)}]`
      : '';

  if (state.published === true) {
    log(`build: ${state.slug} is published (${action.eventType})${detail}`);
    return triggerBuild();
  }

  if (state.published === null) {
    // Published が読めない = Notion 側でプロパティ名か型が変わった疑い。
    // 記事を取りこぼすより気づけないことの方が痛いので、ビルドして検証に落とす
    log(`build: ${state.slug} has no readable Published property (${action.eventType})${detail}`);
    return triggerBuild();
  }

  const publishedChanged = wasPublishedPropertyUpdated(body, state.publishedPropertyId);
  if (publishedChanged === true) {
    log(`build: ${state.slug} was unpublished (${action.eventType})${detail}`);
    return triggerBuild();
  }
  if (publishedChanged === null && action.eventType === 'page.properties_updated') {
    // updated_properties が無く、取り下げかどうか判断できない。
    // 記事が残り続けるより 1 回余分に積む方がまし
    log(
      `build: ${state.slug} is not published but updated_properties is missing (${action.eventType})${detail}`,
    );
    return triggerBuild();
  }

  log(`skip: ${state.slug} is not published (${action.eventType})${detail}`);
  return json(200, { message: 'skipped: not published' });
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    // 壊れたボディはリトライさせても直らない
    log('skip: body is not valid JSON');
    return json(200, { message: 'skipped: invalid JSON' });
  }

  const action = classifyEvent(body);
  const label = action.kind === 'verification' ? 'verification' : action.eventType;

  try {
    switch (action.kind) {
      case 'verification':
        // verification_token は Notion の画面へ貼り戻す必要があるのでログに出す。
        // 購読作成時の 1 回だけで、以後の配信には含まれない
        log(`verification request received. verification_token=${action.token ?? '(none)'}`);
        return json(
          200,
          action.challenge ? { challenge: action.challenge } : { message: 'verification received' },
        );

      case 'skip':
        log(`skip: ${action.reason} (${action.eventType})`);
        return json(200, { message: 'skipped' });

      case 'build':
        log(`build: ${action.reason} (${action.eventType})`);
        return triggerBuild();

      case 'check-page':
        return await decideByPublishState(action, body);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // ここに来るのは Notion API 呼び出しの失敗。200 を返すと変更が失われるので
    // 500 にして Notion のリトライ（最大 8 回 / 約 24 時間）に任せる
    console.error(`[webhook] error while handling ${label}: ${message}`);
    return json(500, { error: 'Internal Server Error' });
  }
};
