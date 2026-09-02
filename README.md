# Philosophizing with AI

[blog.florigen.ai](https://blog.florigen.ai) のソース。
Astro + Notion + Vercel で動く個人ブログ。

## アーキテクチャ

```text
Notion データベース（記事の実体）
      │  Notion REST API を直接叩く（src/lib/notion.ts）
      ▼
Astro（src/pages/*.astro でレンダリング）
      ▼
Vercel（@astrojs/vercel アダプタ）
```

記事は Markdown ファイルではなく **Notion データベースの行**として存在する。
`src/content/` は使っていない。

### Notion データベースのプロパティ

| プロパティ | 型 | 必須 | 用途 |
|---|---|---|---|
| `名前` | title | ※ | シリーズ接頭辞。例: `AIと実装01` |
| `Title` | rich_text | ※ | 本タイトル。表示は `名前；Title` の連結 |
| `Slug` | rich_text | ✅ | URL。`/posts/<slug>` |
| `Date` | date | ✅ | 公開日。時刻の有無は行によって異なる |
| `Published` | checkbox | ✅ | **公開判定はこれだけを見る** |
| `Content` | rich_text | ✅ | 本文。現状は WordPress の Gutenberg HTML |
| `Tags` | rich_text | ✅ | 読点・カンマ・空白区切り |
| `Description` | rich_text | | 記事概要。未設定なら警告のみ |
| `HeroImage` | files | | アイキャッチ |
| `Status` | rich_text | | `publish` / `draft` / 空。**現状コードは参照していない** |

※ `名前` と `Title` はどちらか一方が埋まっていればよい。

`Published` と `Status` は現状ずれている行がある（公開判定は `Published` が正）。

### 検証とビルドの失敗条件

`src/lib/notion-schema.ts` が Notion の応答を zod で検証する。
「静かに空になる」のを避けるため、以下はビルドを**失敗**させる。

- 必須プロパティの欠落・型違い（Notion 側でプロパティ名を変えた場合を含む）
- `Slug` / `Date` / `Content` が空
- 公開記事が 0 件、または `MIN_EXPECTED_POSTS`（既定 10）を下回る
- `Content` の rich_text が 25 要素に達している（Notion API の上限。本文が切れている疑い）

`Description` や `Tags` の欠落は警告のみで、ビルドは通る。

## 記事の書き方

1. Notion データベースに行を追加する
2. `名前` にシリーズ接頭辞（`AIと哲学13` のような「ラベル＋連番」）を入れる
   - シリーズ別アーカイブはこの命名規則から自動生成される（`src/lib/series.ts`）
   - 新しい `AIと◯◯` を作ってもコード変更は不要
   - 既知シリーズの表示順だけ `SERIES_DISPLAY_ORDER` で指定している
3. `Title` `Slug` `Date` `Tags` `Content` を埋める
4. `Published` にチェックを入れる

本文フォーマットは現在 WordPress の Gutenberg HTML のみ。
Markdown と Notion ページ本文への対応は進行中（Phase 4 / 5）。

日本語タグを英語 slug に変換するマッピングは `src/lib/tag-slugs.ts` にある。
未登録のタグは URL エンコードされた日本語 slug になる。

## 開発

```sh
npm install
vercel env pull .env --environment=development   # NOTION_API_KEY / NOTION_DATABASE_ID
npm run dev
```

`.env` は git 管理外。

> **注意**: Astro は `.env` を `import.meta.env` にしか載せない。
> `src/lib/env.ts` が `import.meta.env` と `process.env` の両方を見るので通常は意識不要だが、
> スクリプトから直接叩くときは `node --env-file=.env ...` を使うこと。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ（localhost:4321） |
| `npm run build` | 本番ビルド |
| `npm test` | ユニットテスト（`node:test`） |

## デプロイ

`main` への push で Vercel が自動デプロイする。
Notion の更新は `src/pages/api/notion-webhook.ts` が Vercel Deploy Hook を叩いて反映する
（`VERCEL_DEPLOY_HOOK_URL` が必要）。

## ディレクトリ

```text
src/
├── components/   BaseHead / Header / Footer / FormattedDate
├── layouts/      BlogPost.astro（/about が使用）
├── lib/
│   ├── notion.ts         Notion API との通信
│   ├── notion-schema.ts  応答の検証と Post への正規化
│   ├── types.ts          Post 型
│   ├── series.ts         シリーズ判定
│   ├── tag-slugs.ts      日本語タグ → 英語 slug
│   └── download-image.ts 画像の恒久化（未実装）
├── pages/
│   ├── index.astro       アーカイブトップ
│   ├── blog.astro        記事一覧
│   ├── about.astro
│   ├── posts/[slug].astro
│   ├── tags/[slug].astro
│   ├── rss.xml.js / sitemap.xml.ts
│   └── api/notion-webhook.ts
└── styles/global.css
```
