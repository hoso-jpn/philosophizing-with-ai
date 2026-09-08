import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { findForbiddenRemoteImages, findMissingLocalImages } from './build-artifacts.ts';

const temporaryRoots: string[] = [];

async function fixture(html: string, files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'article-build-'));
  temporaryRoots.push(root);
  await writeFile(path.join(root, 'index.html'), html);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('findForbiddenRemoteImages', () => {
  it('Notion の S3 URL と停止済み旧ドメインを検出し、query を診断から除く', async () => {
    const root = await fixture(`
      <img src="https://prod-files-secure.s3.us-west-2.amazonaws.com/a.svg?X-Amz-Signature=secret">
      <img src="https://philosophizing-with-ai.com/old.png?token=secret">
      <img src="https://images.example.com/permanent.png">
    `);

    assert.deepEqual(await findForbiddenRemoteImages(root), [
      'index.html: https://prod-files-secure.s3.us-west-2.amazonaws.com/a.svg',
      'index.html: https://philosophizing-with-ai.com/old.png',
    ]);
  });
});

describe('findMissingLocalImages', () => {
  it('query 付き・percent encode 済みのサイト内画像が実在すれば通す', async () => {
    const root = await fixture(
      '<img src="/notion-static/%E5%9B%B3.svg?v=1#preview"><img src="https://example.com/external.png">',
      { 'notion-static/図.svg': '<svg />' },
    );

    assert.deepEqual(await findMissingLocalImages(root), { offenders: [], checkedCount: 1 });
  });

  it('欠落画像を検出する', async () => {
    const root = await fixture('<img src="/notion-static/missing.svg">');

    assert.deepEqual(await findMissingLocalImages(root), {
      offenders: ['index.html: /notion-static/missing.svg'],
      checkedCount: 1,
    });
  });

  it('path traversal と壊れた percent 表記を fail closed で拒否する', async () => {
    const root = await fixture('<img src="/../../../../etc/hosts"><img src="/notion-static/%zz.svg">');
    const result = await findMissingLocalImages(root);

    assert.equal(result.checkedCount, 1);
    assert.match(result.offenders[0], /出力ディレクトリの外/);
    assert.match(result.offenders[1], /% 表記が壊れています/);
  });
});
