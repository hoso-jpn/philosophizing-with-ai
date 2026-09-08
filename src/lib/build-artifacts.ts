import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const FORBIDDEN_IMAGE_HOSTS = [
  'amazonaws.com',
  'philosophizing-with-ai.com',
];

const IGNORED_LOCAL_IMAGE_PREFIXES = ['/_image', '/@'];

async function listHtmlFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
}

/** 生成 HTML に残った、期限付きまたは停止済みホストの画像 URL を返す。 */
export async function findForbiddenRemoteImages(root: string): Promise<string[]> {
  const offenders: string[] = [];

  for (const file of await listHtmlFiles(root)) {
    const html = await readFile(file, 'utf-8');
    for (const match of html.matchAll(/<img\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["']/gi)) {
      const host = new URL(match[1]).hostname;
      if (FORBIDDEN_IMAGE_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) {
        // 署名や token をログへ出さない。
        offenders.push(`${path.relative(root, file)}: ${match[1].split('?')[0]}`);
      }
    }
  }

  return offenders;
}

export type LocalImageIntegrityResult = {
  offenders: string[];
  checkedCount: number;
};

/** 生成 HTML が参照するサイト内画像の欠落・不正パスを返す。 */
export async function findMissingLocalImages(root: string): Promise<LocalImageIntegrityResult> {
  const rootResolved = path.resolve(root);
  const offenders: string[] = [];
  const checked = new Set<string>();

  for (const file of await listHtmlFiles(root)) {
    const html = await readFile(file, 'utf-8');

    for (const match of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
      const src = match[1];
      if (!src.startsWith('/') || src.startsWith('//')) continue;
      if (IGNORED_LOCAL_IMAGE_PREFIXES.some((prefix) => src.startsWith(prefix))) continue;

      let pathname: string;
      try {
        pathname = decodeURIComponent(src.split(/[?#]/)[0]);
      } catch {
        offenders.push(`${path.relative(root, file)}: ${src}（URL の % 表記が壊れています）`);
        continue;
      }

      const key = `${path.relative(root, file)}\u0000${pathname}`;
      if (checked.has(key)) continue;
      checked.add(key);

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

  return { offenders, checkedCount: checked.size };
}
