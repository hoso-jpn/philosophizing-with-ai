import { access, cp, readdir, stat } from 'node:fs/promises';
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
        // 画像だけを出力へ入れる。`<digest>.json` は「この成果物は検証を通した」ことを
        // 記録するビルド用のファイルで、公開する意味が無い（取得元のパスが読者から
        // 見えるだけになる）。`.tmp` は publish 途中で落ちた場合の残骸
        await cp(SOURCE, destination, {
          recursive: true,
          filter: (source) => !/\.(json|tmp)$/.test(source),
        });
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

/**
 * 生成 HTML が指しているサイト内の画像が、出力に実在することを確かめる。
 *
 * assert-no-remote-images-in-output は「期限付き・停止済みホストの画像が
 * 残っていないか」を見る。**その裏返しがここ。** ローカル化が成功して
 * `/notion-static/...` へ書き換わったのに、実ファイルが出力へ入っていなければ、
 * ビルドは成功したのに画像だけ 404 になる。SSG では誰も気づかないまま公開される。
 *
 * copy-downloaded-images より **後**に走らせる必要がある。あちらが
 * `public/notion-static/` を出力へコピーするので、その前に見ると必ず失敗する。
 * astro.config.mjs の integrations の並び順がそのまま実行順になる。
 */
export function assertLocalImagesExist() {
  /** 出力に実体を持たない仮想パス。ここに該当するものは検査対象外 */
  const IGNORED_PREFIXES = ['/_image', '/@'];

  return {
    name: 'assert-local-images-exist',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const rootResolved = path.resolve(root);
        const offenders = [];
        const checked = new Set();

        for (const file of await listHtmlFiles(root)) {
          const html = await readFile(file, 'utf-8');

          for (const match of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
            const src = match[1];
            // サイト内の絶対パスだけを見る。外部 URL は別の検査が担当し、
            // 相対パスは記事本文では使っていない
            if (!src.startsWith('/') || src.startsWith('//')) continue;
            if (IGNORED_PREFIXES.some((prefix) => src.startsWith(prefix))) continue;

            // クエリとフラグメントを落とし、%E3%81%82 のような表記を実ファイル名へ戻す。
            // 壊れた percent 表記は URIError になる。素の例外で落ちると原因の
            // 分からないビルド失敗になるので、この検査の違反として扱う
            let pathname;
            try {
              pathname = decodeURIComponent(src.split(/[?#]/)[0]);
            } catch {
              offenders.push(`${path.relative(root, file)}: ${src}（URL の % 表記が壊れています）`);
              continue;
            }

            const key = `${path.relative(root, file)}\u0000${pathname}`;
            if (checked.has(key)) continue;
            checked.add(key);

            // 出力ディレクトリの外を指していないか。
            //
            // `/notion-static/../../../../etc/hosts` は path.join で `/etc/hosts` に
            // なり、実在するので access() が通ってしまう。存在検査が
            // **通ってはいけない入力で通る**のは、検査として意味を失う（fail open）。
            const target = path.resolve(rootResolved, `.${pathname}`);
            if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
              offenders.push(`${path.relative(root, file)}: ${pathname}（出力ディレクトリの外を指しています）`);
              continue;
            }

            try {
              await access(target);
            } catch {
              offenders.push(`${path.relative(root, file)}: ${pathname}`);
            }
          }
        }

        if (offenders.length > 0) {
          throw new Error(
            `生成 HTML が指しているサイト内の画像が出力にありません（${offenders.length} 箇所）。\n` +
              offenders.map((o) => `  - ${o}`).join('\n') +
              '\n\nビルドは成功していますが、この画像は本番で 404 になります。\n' +
              '`public/notion-static/` からのコピー（copy-downloaded-images）や\n' +
              'src/lib/download-image.ts のローカル化を確認してください。',
          );
        }
        logger.info(`生成 HTML のサイト内画像 ${checked.size} 件はすべて出力に存在`);
      },
    },
  };
}
