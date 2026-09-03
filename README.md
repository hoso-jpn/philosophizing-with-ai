# Philosophizing with AI

[blog.florigen.ai](https://blog.florigen.ai) のソース。
Astro + Notion + Vercel で動く個人ブログ。

> **決定ログ**: Phase の順序・購読イベント・公開判定の基準といった合意済みの決定は
> [PR #1](https://github.com/hoso-jpn/philosophizing-with-ai/pull/1) の本文冒頭にある。
> **作業を再開するときは、他のどこよりも先にそこを読むこと。**
> 決定が会話の中にしか無く、合意済みの順序を後から再提案してしまったことがあるため。
> Phase 2+3 のマージ時に `docs/decisions.md` へ移す。

> **この README の記述は 2026-09-03 にコードと突き合わせて検証済み。**
> 実装の記憶から書いた誤りが実際に見つかったため（`MIN_EXPECTED_POSTS` の既定値、
> `Status` の参照有無など）、以後も「〜していない」「〜のみ」といった否定形・限定形の
> 断定を書くときは `grep` で裏を取ること。裏が取れないものは「未検証」と明記する。

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

※ `名前` と `Title` はどちらか一方が埋まっていればよい。

> `Status` 列（`publish` / `draft` の自由入力）は **2026-09-03 に廃止**した。
> `Published` と実態がずれる行があり、二重管理になっていたため。
> **公開判定は `Published` だけを見る。**

### 検証とビルドの失敗条件

`src/lib/notion-schema.ts` が Notion の応答を zod で検証する。
「静かに空になる」のを避けるため、以下はビルドを**失敗**させる。

- 必須プロパティの欠落・型違い（Notion 側でプロパティ名を変えた場合を含む）
- `Slug` / `Date` / `Content` が空
- 公開記事が 0 件、または `MIN_EXPECTED_POSTS`（既定 **14**、`src/lib/env.ts`）を下回る
- `Content` の rich_text が 25 要素に達している（Notion API の上限。本文が切れている疑い）

`Description` や `Tags` の欠落は警告のみで、ビルドは通る。

Notion から記事を取得できたら、**件数チェックの成否にかかわらず**取得件数と下限を
1行出力する（下限が実態から乖離していることに気づけるようにするため）。

```text
[notion] 16 posts fetched (floor: 14)
```

認証失敗や API 障害では `notionFetch` がこの行より前に例外を投げるので、
この行は出ない。**出ていないこと自体が「取得に到達していない」の合図**になる。

> **運用**: 記事を数本追加したら `src/lib/env.ts` の `MIN_EXPECTED_POSTS` の
> 既定値を上げること。上の行を見れば乖離に気づけるようにしてある。
> 一時的に下回らせたいだけなら環境変数 `MIN_EXPECTED_POSTS` で上書きする。

## 記事の書き方

1. Notion データベースに行を追加する
2. `名前` にシリーズ接頭辞（`AIと哲学13` のような「ラベル＋連番」）を入れる
   - シリーズ別アーカイブはこの命名規則から自動生成される（`src/lib/series.ts`）
   - 新しい `AIと◯◯` を作ってもコード変更は不要
   - 既知シリーズの表示順だけ `SERIES_DISPLAY_ORDER` で指定している
3. `Title` `Slug` `Date` `Tags` `Content` を埋める
4. `Published` にチェックを入れる

記事を追加したら `MIN_EXPECTED_POSTS` の既定値の見直しも忘れないこと。

`Content` に入っている実データは現在 WordPress の Gutenberg HTML のみ。
ただし描画は `src/pages/posts/[slug].astro` で `marked(post.content)` を通しており、
**marked は生 HTML を素通しし Markdown も解釈する**ため、Markdown を書いても描画はされる。

未実装なのは描画そのものではなく**フォーマットの判定層**で、`Format` プロパティを
見て変換を切り替える処理が Phase 4 の対象（Notion ページ本文への対応は Phase 5）。

### 本文に図を入れる

`Content` は HTML テキストなので、画像は **URL 参照しか書けない**。
Notion にアップロードした画像の URL は署名付きで 1 時間で切れるため、
本文へ直書きできない。当面は次の手順を使う。

1. 画像を `public/images/` へ置く（例: `public/images/ammi-biplot.png`）
2. 本文から `/images/<ファイル名>` で参照する

```html
<figure><img src="/images/ammi-biplot.png" alt="AMMI バイプロット"/></figure>
```

`/images/...` のようなサイト内パスはビルドのローカル化処理を素通りする
（`src/lib/download-image.ts`）。外部 URL だけがダウンロード対象になる。

> **旧ドメイン `philosophizing-with-ai.com` は停止済み**。本文がこのドメインを
> 参照しているとビルドが失敗する（`assertNoLegacyDomainReference`）。
> 画像は上の手順で差し替え、記事へのリンクは `/posts/<slug>/` に書き換える。

> これは暫定手段。**本命は Phase 5** で、本文を Notion のページ本文へ移せば
> 画像は Notion の画像ブロックになり、ビルド時のパイプラインが解決する。
> そうなれば `public/images/` へ手で置く運用は不要になる。

日本語タグを英語 slug に変換するマッピングは `src/lib/tag-slugs.ts` にある。
未登録のタグは URL エンコードされた日本語 slug になる。

## 開発

```sh
npm install
vercel env pull .env --environment=development   # NOTION_API_KEY / NOTION_DATABASE_ID / VERCEL_OIDC_TOKEN
npm run dev
```

`.env` は git 管理外。

> **注意**: Astro は `.env` を `import.meta.env` にしか載せない。
> `src/lib/env.ts` が `import.meta.env` と `process.env` の両方を見るので通常は意識不要だが、
> スクリプトから直接叩くときは `node --env-file=.env ...` を使うこと。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ（localhost:4321） |
| `npm run build` | 型チェック（`astro check`）→ 本番ビルド |
| `npm run typecheck` | 型チェックのみ |
| `npm test` | ユニットテスト（`node:test`） |

型エラーがあるとビルドは失敗する。「失敗は失敗として見せる」方針に合わせている。

## デプロイ

`main` への push で Vercel が自動デプロイする。
Notion の更新は `src/pages/api/notion-webhook.ts` が Vercel Deploy Hook を叩いて反映する
（`VERCEL_DEPLOY_HOOK_URL` が必要）。

### Vercel Hobby の制約

| 項目 | Hobby |
|---|---|
| デプロイ作成数 | **100 回/日** |
| 同時ビルド | **1 本** |
| デプロイフックの起動 | **60 回/時**（プロジェクト単位・全フック合算） |
| ビルド時間 | 45 分/デプロイ |

ビルドが**失敗した場合、本番ドメインは直前の成功デプロイを配信し続ける**。
Vercel のデプロイは不変（immutable）で、ドメインはポインタでしかなく、
ビルドが成功して初めて本番エイリアスが張り替わる。これはプラン非依存で
Hobby でも Pro でも同じ。壊れた記事が本番に出ることはない。

### webhook のフィルタ

上の枠は執筆中の自動保存で簡単に埋まるため、`notion-webhook.ts` は
受信イベントを振り分けてから Deploy Hook を叩く。判定は `src/lib/webhook-events.ts`。

| イベント | 挙動 |
|---|---|
| `page.created` / `content_updated` / `properties_updated` / `moved` / `deleted` / `undeleted` | 対象ページの `Published` を見る。**true ならビルド、false ならスキップ** |
| `page.locked` / `page.unlocked` | スキップ（出力に影響しない） |
| `data_source.schema_updated` | **ビルドする**。プロパティ名・型の変更は `notion-schema.ts` の検証を壊すので、変更直後にビルド失敗として気づきたい |
| `data_source.content_updated` ほか | スキップ（`page.*` で同じ変更が届くため二重） |
| `comment.*` | スキップ |
| 未知の種別 | スキップ（枠を静かに食い潰さないため）。種別はログに出る |

`Published` が false でも、そのイベントで `Published` プロパティ自体が変更されていれば
ビルドする。**公開 → 非公開（取り下げ）も現在値は false になる**ため、現在値だけで
切ると取り下げた記事がサイトに残り続ける。

スキップ・起動のどちらでもログが 1 行残る。

> **未検証（実イベント待ち）**: `updated_properties` は**プロパティIDの文字列配列**で届き
> （公式サンプル `["XGe%40","bDf%5B","DbAu"]`）、照合に使う `Published` の ID は
> REST API（`2022-06-28`）から読む。系統が違うため表記が一致するかは断定できない。
> 初回イベントのログ `[published_prop=... updated=...]` で突き合わせて確認する。
> 一致しない場合に影響するのは「取り下げ」の検知だけで、公開記事の更新には影響しない。

```text
[webhook] skip: ai-and-philosophy-13 is not published (page.content_updated)
[webhook] build: ai-and-philosophy-12 is published (page.properties_updated)
[webhook] build: ai-and-philosophy-12 was unpublished (page.properties_updated)
```

応答は原則 200 を返す。Notion は 200 以外だと最大 8 回・約 24 時間リトライするため、
「ビルドしないと決めた」ことをリトライで蒸し返させない。500 を返すのは
Notion API 障害など、リトライで直る見込みがあるときだけ。

### Notion 側の購読設定

**URL は本番ドメインを直接指定する。**

```text
https://blog.florigen.ai/api/notion-webhook
```

`philosophizing-with-ai.vercel.app` を指すと Vercel が **308 で
`blog.florigen.ai` へリダイレクトする**（カスタムドメインを primary にしたため）。
webhook の配信元がリダイレクトを追う保証はないので、直接指定する。

**購読するイベント種別（3 + 任意1）:**

| イベント | 要否 | 理由 |
|---|---|---|
| `page.properties_updated` | **必須** | 本文（`Content`）・`Published`・`Title` などの編集。**この構成では実質これが主役** |
| `page.deleted` | **必須** | 公開記事の削除をサイトへ反映する |
| `page.undeleted` | **必須** | 復元を反映する |
| `data_source.schema_updated` | 推奨 | プロパティ名・型の変更を、変更直後にビルド失敗として検知する |
| `page.created` | 任意 | 新規行はほぼ下書きで、公開時に `properties_updated` が続く |
| `page.content_updated` | **不要（今は）** | ページ**本文（ブロック）**専用。本文は `Content` プロパティにあり、ブロックはレンダリングしていない。**Phase 4/5 で Notion ページ本文へ対応したら必須になる** |
| `page.moved` / `page.locked` / `page.unlocked` | 不要 | DB 間移動の運用があれば `moved` のみ検討 |
| `data_source.content_updated` / `comment.*` | 購読しない | `page.*` と二重。コード側でも落とすが、届かせない方が枠に優しい |

> **`page.content_updated` ではなく `page.properties_updated`** である点が重要。
> Notion の定義は `content_updated` = 「ページのブロックの追加・削除」、
> `properties_updated` = 「ページのプロパティの更新」。この構成では本文が
> `Content` プロパティなので、執筆中の自動保存は `properties_updated` で飛ぶ。

購読作成時、Notion は `{"verification_token": "..."}` を 1 度だけ POST する。
その値は Vercel のログに `[webhook] verification request received.` として出るので、
Notion の画面へ貼り戻して検証を完了させる。

### API バージョンについて

2つのバージョンが**別系統**で動いていることに注意する。

| | バージョン | 決めるもの |
|---|---|---|
| 受信（webhook のペイロード） | 購読側の設定（現在 `2026-03-11`） | `entity` / `data.updated_properties` の形 |
| 送信（`src/lib/notion.ts` の REST 呼び出し） | `NOTION_VERSION = '2022-06-28'` | ページ取得・DB クエリの応答の形 |

Notion は「古いバージョンのサポートを終了する予定は今のところ無い」としている。
ただし `databases/{id}/query` は 2025-09-03 でデータソースへ移行済みのため、
`NOTION_VERSION` を上げるときは `queryDatabase()` の書き換えが必要になる。

## ディレクトリ

```text
src/
├── components/   BaseHead / Header / Footer / FormattedDate
├── layouts/      BlogPost.astro（/about が使用）
├── lib/
│   ├── notion.ts         Notion API との通信
│   ├── notion-schema.ts  応答の検証と Post への正規化
│   ├── env.ts            環境変数の読み出しと MIN_EXPECTED_POSTS
│   ├── types.ts          Post 型
│   ├── series.ts         シリーズ判定
│   ├── webhook-events.ts webhook イベントの振り分け
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
