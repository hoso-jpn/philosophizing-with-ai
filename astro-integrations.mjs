import { cp, readdir, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNoSelfReferencingUrls } from './src/lib/content-links.ts';

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
export function copyDownloadedImages() {
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

/**
 * 期限付き URL が生成 HTML に焼き込まれていないことを確かめる。
 *
 * SSG 化の最大の危険がこれ。Notion の HeroImage は署名付き S3 URL で有効期限が
 * 1 時間しかない。SSR の間は毎リクエスト取り直していたので露見しなかったが、
 * SSG では URL がビルド時に HTML へ固定されるため、1 時間後に画像が全滅する。
 *
 * download-image.ts がローカル化しているはずだが、それが壊れてもビルドは成功して
 * しまう（HTML は生成される）。出力を直接見て、機械的に止める。
 */
const FORBIDDEN_IMAGE_HOSTS = [
  'amazonaws.com', // Notion の署名付き S3 URL
  'philosophizing-with-ai.com', // 停止済みの旧ドメイン
];

async function listHtmlFiles(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) found.push(path.join(entry.parentPath, entry.name));
  }
  return found;
}

export function assertNoRemoteImagesInOutput() {
  return {
    name: 'assert-no-remote-images-in-output',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const offenders = [];

        for (const file of await listHtmlFiles(root)) {
          const html = await readFile(file, 'utf-8');
          for (const match of html.matchAll(/<img\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["']/gi)) {
            const host = new URL(match[1]).hostname;
            if (FORBIDDEN_IMAGE_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) {
              offenders.push(`${path.relative(root, file)}: ${match[1].split('?')[0]}`);
            }
          }
        }

        if (offenders.length > 0) {
          throw new Error(
            `生成 HTML に期限付き・停止済みホストの画像が焼き込まれています（${offenders.length} 箇所）。\n` +
              offenders.map((o) => `  - ${o}`).join('\n') +
              '\n\nSSG では URL がビルド時に固定されるため、この画像は期限切れ後に壊れます。\n' +
              'src/lib/download-image.ts のローカル化が働いていない可能性があります。',
          );
        }
        logger.info('生成 HTML に期限付きホストの画像は無し');
      },
    },
  };
}

/**
 * Astro テンプレート内のリンク・画像にも、本文と同じ URL 規則を当てる。
 *
 * assertNoSelfReferencingUrls は Notion の Content しか見ていなかった。そのため
 * src/pages/about.astro に残っていた `/posts/<Notion の UUID>` リンク 3 本を
 * 4 か月以上見逃していた（2026-09-03 発見。現行本番でも 404 だった）。
 * 検査対象を本文に限っていたことが穴だったので、テンプレートにも同じ規則を当てる。
 *
 * 見るのは **文字列リテラルの href / src だけ**。`href={`/posts/${post.slug}`}` の
 * ような式は対象にならないが、それは実行時に slug から作られるので静的には判定できず、
 * 出力側は assert-no-remote-images-in-output と本文検査が受け持つ。
 *
 * MD 化後も意味を持つ検査なので恒久的に入れてよい（本文側の検査と違って
 * Phase 5 で役目を終えない）。
 */
export function assertTemplateUrls() {
  const SOURCE_DIR = path.join(process.cwd(), 'src');

  return {
    name: 'assert-template-urls',
    hooks: {
      'astro:config:setup': async ({ logger }) => {
        const entries = [];
        for (const entry of await readdir(SOURCE_DIR, { withFileTypes: true, recursive: true })) {
          if (!entry.isFile() || !/\.(astro|html)$/.test(entry.name)) continue;
          const file = path.join(entry.parentPath, entry.name);
          entries.push({
            slug: path.relative(process.cwd(), file),
            content: await readFile(file, 'utf-8'),
          });
        }
        assertNoSelfReferencingUrls(entries);
        logger.info(`テンプレート ${entries.length} 件の URL を検査: 問題なし`);
      },
    },
  };
}
