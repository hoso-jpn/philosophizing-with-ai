// lib/download-image.ts
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export async function saveImageLocally(url: string, id: string): Promise<string> {
  // 保存先ディレクトリ: public/notion-static/
  const publicDir = path.join(process.cwd(), 'public', 'notion-static');
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // ファイル名を作成（拡張子はとりあえずpng。Notionの画像は多くがこれ）
  const fileName = `${id}.png`;
  const filePath = path.join(publicDir, fileName);
  const publicPath = `/notion-static/${fileName}`;

  // すでに存在する場合はダウンロードをスキップしてパスだけ返す
  if (fs.existsSync(filePath)) {
    return publicPath;
  }

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000, // 10秒でタイムアウト
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve) => {
      writer.on('finish', () => resolve(publicPath));
      writer.on('error', () => resolve(url)); // 失敗時は元のURLにフォールバック
    });
  } catch (error) {
    console.error(`Failed to download image: ${id}`, error);
    return url;
  }
}