// lib/download-image.ts
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export async function saveImageLocally(url: string, id: string): Promise<string> {
  // --- 【ここを修正】 ---
  // public ではなく、ビルド出力先（dist）と public の両方に書き込むようにします
  const distDir = path.join(process.cwd(), 'dist', 'notion-static');
  const publicDir = path.join(process.cwd(), 'public', 'notion-static');
  
  // 両方のディレクトリを作成
  [distDir, publicDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const fileName = `${id}.png`;
  const publicPath = `/notion-static/${fileName}`;
  const distFilePath = path.join(distDir, fileName);
  const publicFilePath = path.join(publicDir, fileName);

  // どちらかに存在すればスキップ
  if (fs.existsSync(distFilePath) || fs.existsSync(publicFilePath)) {
    return publicPath;
  }
  // ----------------------

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000,
    });

    // dist 側に書き込む
    const writer = fs.createWriteStream(distFilePath);
    response.data.pipe(writer);

    return new Promise((resolve) => {
      writer.on('finish', () => {
        // ローカル開発用に public にもコピー（任意）
        if (fs.existsSync(distFilePath) && !fs.existsSync(publicFilePath)) {
           fs.copyFileSync(distFilePath, publicFilePath);
        }
        resolve(publicPath);
      });
      writer.on('error', () => resolve(url));
    });
  } catch (error) {
    console.error(`Failed to download image: ${id}`, error);
    return url;
  }
}