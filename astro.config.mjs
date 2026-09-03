import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel'; // 末尾に /serverless は付けない

/**
 * ビルド中にダウンロードした Notion の画像を出力へ入れる。
 *
 * Astro は `public/` を **ページ描画より前に**出力へコピーする。一方
 * src/lib/download-image.ts のダウンロードは getStaticPaths / ページ描画の
 * 最中に走るので、`public/notion-static/` へ落ちた時点ではコピーが済んでいる。
 * 何もしないと HTML は /notion-static/... を指しているのに実体が出力に無い、
 * という状態で「ビルドは成功しているのに画像だけ 404」になる。
 *
 * そこで描画後（astro:build:done）に出力ディレクトリへコピーし直す。
 */
function copyDownloadedImages() {
  const SOURCE = path.join(process.cwd(), 'public', 'notion-static');

  return {
    name: 'copy-downloaded-images',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        try {
          await stat(SOURCE);
        } catch {
          logger.info('notion-static: ダウンロード済みの画像なし');
          return;
        }
        const destination = path.join(fileURLToPath(dir), 'notion-static');
        await cp(SOURCE, destination, { recursive: true });
        logger.info(`notion-static: ${destination} へコピーしました`);
      },
    },
  };
}

export default defineConfig({
    site: 'https://blog.florigen.ai',
    // 記事はビルド時に静的生成する（Notion への問い合わせはビルド時だけ）。
    // アダプタは残す。src/pages/api/notion-webhook.ts だけが prerender = false で
    // サーバ上に残り、Notion からの webhook を受ける。
    output: 'static',
    integrations: [
        mdx(),
        copyDownloadedImages(),
    ],
    adapter: vercel(),
});
