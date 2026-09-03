import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Notion webhook の署名を計算する。
 *
 * Notion は購読作成時に届く verification_token を HMAC-SHA256 の共有秘密として使い、
 * 以後のイベントでは raw request body に対する署名を X-Notion-Signature に載せる。
 */
export function computeNotionWebhookSignature(rawBody: string, verificationToken: string): string {
  const digest = createHmac('sha256', verificationToken).update(rawBody).digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * X-Notion-Signature を timing-safe に検証する。
 * 欠落・形式不正・本文改変・token 不一致はいずれも false。
 */
export function verifyNotionWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  verificationToken: string,
): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = Buffer.from(computeNotionWebhookSignature(rawBody, verificationToken));
  const actual = Buffer.from(signatureHeader);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
