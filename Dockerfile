# 1. ベースとなるOS（Node.jsが入った軽量なLinux）を指定
FROM node:22-slim

# 2. コンテナ内の作業ディレクトリ（フォルダ）を決める
WORKDIR /app

# 3. ライブラリの定義ファイルを先にコピー（効率化のため）
COPY package*.json ./

# 4. ライブラリをインストール
RUN npm install

# 5. プロジェクトの全ファイルをコンテナ内にコピー
COPY . .

# 6. Astroの開発サーバーが使うポート番号を開放
EXPOSE 4321

# 7. コンテナ起動時に実行するコマンド（開発モード起動）
CMD ["npm", "run", "dev", "--", "--host"]