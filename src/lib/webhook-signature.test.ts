import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeNotionWebhookSignature,
  verifyNotionWebhookSignature,
} from './webhook-signature.ts';

const verificationToken = 'notion-webhook-test-secret';
const rawBody = '{"type":"page.properties_updated","entity":{"type":"page","id":"page-1"}}';
const knownSignature =
  'sha256=0458a3e3b6cfd9bb3ead31c476500f2ac97de8293863ea6b98f7b91b3335d401';

describe('Notion webhook signature', () => {
  it('固定テストベクトルと同じ HMAC-SHA256 署名を生成する', () => {
    assert.equal(computeNotionWebhookSignature(rawBody, verificationToken), knownSignature);
  });

  it('正しい署名だけを受け付ける', () => {
    assert.equal(verifyNotionWebhookSignature(rawBody, knownSignature, verificationToken), true);
    assert.equal(verifyNotionWebhookSignature(`${rawBody} `, knownSignature, verificationToken), false);
    assert.equal(verifyNotionWebhookSignature(rawBody, knownSignature, `${verificationToken}x`), false);
  });

  it('署名ヘッダー欠落・形式不正を拒否する', () => {
    assert.equal(verifyNotionWebhookSignature(rawBody, null, verificationToken), false);
    assert.equal(verifyNotionWebhookSignature(rawBody, '0458a3e3', verificationToken), false);
    assert.equal(verifyNotionWebhookSignature(rawBody, 'sha256=deadbeef', verificationToken), false);
  });
});
