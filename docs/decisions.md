# Architecture decisions

最終更新: 2026-09-03

この文書は、PR #1 までに確定した設計判断の正本です。会話や古いPRコメントではなく、この文書を優先してください。

## D-1 — SSG 化の順序

Phase 2+3 は統合し、**画像の恒久化 → `getStaticPaths` → `output: 'static'`** の順で進める。

理由: Notion の files URL は期限付きであり、先に SSG 化すると期限付きURLがHTMLへ焼き込まれるため。

## D-2 — Phase 1–3 を一体で main へ出す

型・検証層だけを単独で main へ出さず、SSG / 画像恒久化 / webhook 抑制と同時に反映する。

## D-3 — 公開判定

公開判定は `Published` checkbox のみを正とする。旧 `Status` 列は廃止。

## D-4 — Notion webhook の購読イベント

Phase 1–3 時点の購読対象:

- `page.properties_updated`
- `page.deleted`
- `page.undeleted`
- `data_source.schema_updated`

本文を Notion ページ本文へ移行する Phase 5 では `page.content_updated` を追加する。

## D-5 — webhook の再開時期

Notion の購読は Phase 1–3 を本番へ反映した後に再開する。

## D-6 — 旧ドメイン

`philosophizing-with-ai.com` は既に停止済み。旧ドメイン参照は復元せず、内部リンクは `/posts/<slug>` へ修正し、失われた図は作り直すか削除する。

## D-7 — 公開記事数の下限

`MIN_EXPECTED_POSTS` は当面定数運用する。既定値は `src/lib/env.ts` を正とし、記事数が増えたら見直す。

## D-8 — 不確実な点は実測する

実測できるものは推測で埋めない。確認済み・未検証を分け、否定形や限定形の断定はコードまたは実ログで裏を取る。

## D-9 — Vercel CLI

検証では読み取り専用操作のみを使う。`vercel deploy` / `vercel --prod` / `vercel env add|rm` は自動実行しない。

## D-10 — AIと統計学02 / 03

旧 WordPress 上の図が失われているため、当面は下書きのままとし、リファクタリングとは切り離して再作成する。

## D-11 — Phase 5 前の本文画像

暫定的に `public/images/` へ置き、本文から `/images/<file>` で参照する。これは恒久運用にしない。

## D-12 — 本命は Notion ページ本文

Phase 5 で本文を Notion ページ本文へ移し、画像ブロックもビルド時にローカル化する。

## D-13 — 内部リンクは相対パス

`blog.florigen.ai` / 旧ドメイン / `*.vercel.app` を指す自サイト絶対URLは禁止。内部リンクは `/posts/<slug>` を使う。

## D-14 — 内部リンクを自動書き換えしない

誤ったソースをパイプラインで隠さない。Notion / Markdown 側のソースを修正する。

## D-15 — 本文画像の事後条件

本文画像はローカル化してから「外部URLが残っていない」ことを検査する。

## D-16 — 公開記事だけを本文検査対象にする

下書きの旧参照が Phase 5 の移行作業を妨げないよう、公開記事だけをビルドの不変条件に含める。

## D-17 — 旧ドメイン検査はローカル化より前

停止済みドメインは取得失敗よりも、修正対象URLを直接示すエラーを優先する。

## D-18 — 外部画像の複製をログへ残す

実際に外部画像を取り込んだ場合、クエリを除いた取得元と保存先をビルドログへ出す。

## D-19 — 自サイト参照の共通規則

Notion本文・Astroテンプレート・将来のNotionページ本文で同一のURL規則を使う。規則は `src/lib/content-links.ts` に集約する。

## D-20 — 本文参照ホストを可視化

公開記事本文中のURLホストをビルドログへ一覧表示し、禁止リストだけでは拾えない想定外参照を観測する。

## D-21 — 表示タイトル

Phase 6 で表示タイトルを `Title` のみにする。`名前` はシリーズ判定・順序管理用として保持する。

## D-22 — 本文一括改修

Phase 5 完了後に行う。対象:

1. 全記事の Markdown 化
2. Gutenberg / HTML コメント欠陥の解消
3. 事実誤認・用語・引用形式の修正
4. 文体ルールの統一
5. 変換後の人手レビュー

## D-23 — マージ後の webhook 認証手順

署名検証を有効にするため、次の順序に固定する。

1. PR の Preview が Ready であることを確認
2. main へマージし、本番 SSG を反映
3. 本番 `/api/notion-webhook` が verification request を受けられることを確認
4. Notion で購読を作成 / 再認証し、**verification token を安全な管理画面から取得**
5. Vercel に `NOTION_WEBHOOK_VERIFICATION_TOKEN` を Production 環境変数として設定
6. 環境変数を含む新しい Production deployment を作成
7. Notion 側の購読を有効化
8. 下書き保存で build が起きないことを確認
9. 公開記事編集で build が起きることを確認
10. 公開 → 非公開で build が起き、記事が消えることを確認

verification token をアプリケーションログへ恒久的に残さない。

## D-24 — URL の末尾スラッシュ

`trailingSlash: 'never'` を正とする。

`@astrojs/vercel` は出力形式を directory にするため、`build.format: 'file'` には依存しない。Vercel adapter が生成する 308 の末尾スラッシュ除去ルートで canonical / RSS / sitemap / 内部リンクを末尾スラッシュ無しへ揃える。

## D-25 — 生成HTMLの画像検査

`astro:build:done` で生成HTMLを直接検査し、期限付きS3 URLや停止済みホストの画像が残っていれば失敗する。

## D-26 — 1ビルド = 1記事スナップショット

production build では `getPosts()` の Promise をメモ化し、一覧・記事・タグ・RSS・sitemap が同じNotionスナップショットを見るようにする。devではメモ化しない。

## D-27 — 署名URLの再署名リトライ

実装しない。取得直後に画像をローカル化し、403等はビルド失敗として見せる。

## D-28 — SSG 前後の差分

SSG 移行時は期待差分を先に列挙し、それ以外の出力差分を調査する。バイト一致は要求しない。

## D-29 — URL規則は層ごとに複製しない

URL不変条件は1箇所に集約し、Notion本文・Astroテンプレート・将来の本文レンダラーから呼ぶ。負のテストも必ず用意する。

## D-30 — webhook の署名検証

通常イベントは `X-Notion-Signature` を HMAC-SHA256 で検証し、署名済みイベントだけを処理する。購読作成時の verification request のみ例外。

## D-31 — 削除・復元イベントは常にビルド

`page.deleted` / `page.undeleted` はイベント後のページ再取得可否に依存しない。低頻度なので常にビルドし、公開記事の削除・復元を取りこぼさない。

## D-32 — property ID は正規化して比較

Webhook の `updated_properties` と REST API の property ID は percent-encoding 表記が異なる可能性がある。比較時に decode して同一視し、公開→非公開の検知を表記差に依存させない。
