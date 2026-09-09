# Philosophizing with AI

[blog.florigen.ai](https://blog.florigen.ai) のソース。Astro + Notion + Vercel で動く個人ブログです。

設計判断の正本は [`docs/decisions.md`](docs/decisions.md) です。作業再開時は README より先にそちらを確認してください。

## アーキテクチャ

```text
Notion database
   │  REST API
   ▼
Astro
   ├─ 記事・タグ・RSS・sitemap: build 時に静的生成
   └─ /api/notion-webhook: server route
   ▼
Vercel
```

公開記事は `Published=true` の行だけを取得します。production build では `getPosts()` をメモ化し、1ビルド中の一覧・記事・タグ・RSS・sitemap が同じ Notion スナップショットを見るようにしています。

## Notion データベース

| プロパティ | 型 | 必須 | 用途 |
|---|---|---:|---|
| `名前` | title | ※ | シリーズ接頭辞。例: `AIと哲学12` |
| `Title` | rich_text | ※ | 本タイトル |
| `Slug` | rich_text | ✅ | `/posts/<slug>` |
| `Date` | date | ✅ | 公開日 |
| `Published` | checkbox | ✅ | 公開判定 |
| `Content` | rich_text | ✅ | 現在の本文。Phase 5 でページ本文へ移行予定 |
| `Tags` | rich_text / multi_select | ✅ | タグ |
| `Description` | rich_text |  | 概要 |
| `HeroImage` | files |  | アイキャッチ |
| `Format` | select / rich_text |  | Phase 4 用。未使用でも壊れない |

※ `名前` と `Title` はどちらか一方が必要です。

旧 `Status` 列は廃止し、公開判定は `Published` に一本化しています。

## ビルドの不変条件

次の状態は静かに公開せず、ビルドを失敗させます。

- 必須プロパティの欠落・型違い
- `Slug` / `Date` / `Content` が空
- 公開記事が 0 件、または `MIN_EXPECTED_POSTS` を下回る
- 自サイトを指す絶対 URL や `/posts/<Notion UUID>` が残っている
- 外部画像のローカル化に失敗する
- 生成 HTML に期限付き S3 URL / 停止済み旧ドメイン画像が残る

`Description` / `Tags` の欠落は警告に留めます。

`rich_text` の**要素数 25 自体は失敗条件にしません**。Notion の 25 件制限を rich_text 断片数の上限と解釈すると、リンクや装飾で断片が増えた正常な本文を誤って弾くためです。

## URL ルール

内部リンクは相対パスで書きます。

```text
/posts/<slug>
```

次は本文・Astroテンプレートとも禁止です。

- `https://blog.florigen.ai/...`
- `https://philosophizing-with-ai.com/...`
- `https://*.vercel.app/...`
- `/posts/<Notion page UUID>`

規則は `src/lib/content-links.ts` に集約しています。

URL は末尾スラッシュ無しを canonical とします。`trailingSlash: 'never'` を使用し、RSS / sitemap / 内部リンクも揃えます。

## 画像

Notion の files URL は期限付きなので、HeroImage と外部本文画像は build 時に `public/notion-static/` へローカル化します。

実際に外部画像を取得した場合は、署名クエリを除いた取得元をログに残します。

```text
[images] localized: https://example.com/image.png → /notion-static/<hash>.png (slug)
```

Phase 5 前に本文へ手動で図を入れる場合は、暫定的に `public/images/` へ置いて `/images/<file>` で参照します。

## Notion webhook

`src/pages/api/notion-webhook.ts` は Notion のイベントを振り分け、必要なときだけ Vercel Deploy Hook を起動します。

購読対象:

- `page.properties_updated`
- `page.deleted`
- `page.undeleted`
- `data_source.schema_updated`

Phase 5 で Notion ページ本文へ移行したら `page.content_updated` も追加します。

### ビルド判定

- 公開記事の更新: build
- 下書きの通常更新: skip
- `Published: true → false`: build
- `page.deleted` / `page.undeleted`: **常に build**
- schema update: build
- comment / lock / unknown event: skip

削除・復元は、イベント後に対象ページを REST API で再取得できることへ依存させません。

`updated_properties` の property ID は Webhook と REST API で percent-encoding 表記が違っても一致するよう正規化して比較します。

### 署名検証

通常イベントは `X-Notion-Signature` を検証してから処理します。

必要な環境変数:

```text
NOTION_API_KEY
NOTION_DATABASE_ID
VERCEL_DEPLOY_HOOK_URL
NOTION_WEBHOOK_VERIFICATION_TOKEN
```

購読作成時の `verification_token` は通常イベントの署名秘密です。Production の `NOTION_WEBHOOK_VERIFICATION_TOKEN` として保存し、**環境変数を含む新しい Production deployment を作成してから購読を有効化**してください。

verification token をソース・PR本文・恒久ログへ貼らないでください。

### 本番反映後の確認順

1. main の Production deployment が Ready
2. webhook endpoint が verification request を受けられることを確認
3. Notion の購読を作成 / 再認証
4. verification token を Vercel Production env に登録
5. 新しい Production deployment を作成
6. 購読を有効化
7. 下書き保存 → build されない
8. 公開記事編集 → build される
9. 公開→非公開 → build され、記事が消える
10. 削除 / 復元 → build される

## 開発

```sh
npm install
vercel env pull .env --environment=development
npm run dev
```

主なコマンド:

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ |
| `npm run build` | `astro check && astro build` |
| `npm run typecheck` | 型チェック |
| `npm test` | `node:test` |

`.env*` と `public/notion-static/` は Git 管理外です。

## 今後

PR #1 のスコープは Phase 1–3 です。Markdown 本文への一括移行・記事の事実修正・引用形式・文体統一は Phase 5 で行います。

Phase 5 の本文改修対象は `docs/decisions.md` の D-22 を正とします。
