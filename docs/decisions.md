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

## D-33 — 本文 source を型で分ける

記事本文を `content: string` 一本で持つのをやめ、`ArticleContentSource`（`legacy` / `notion-page` の discriminated union）を正本にする。描画側は必ず `kind` で分岐する。文字列だけでは legacy `Content` プロパティと Notion のページ本文（block の配列）を区別できず、移行の途中で取り違えても型が助けてくれない。

`Post.content` は legacy source の中身として残すが、描画には使わない。

## D-34 — 移行は allowlist で記事単位に行う

canary 期間中の切り替えは、版管理された `src/lib/migration-allowlist.ts` の slug 一覧で決める。

「ページ本文が空でなければページ本文を使う」だけにすると、legacy `Content` で公開中の記事のページ本文にたまたま何か書かれていた瞬間に本文が差し替わる。Notion のページには編集の副産物が残っていることがあるため、判定より前に明示的な一覧を通す。

初期値は空。戻すときは slug を配列から消す。

## D-35 — 取得の失敗を空本文として扱わない

Notion のページ本文の取得が失敗した場合、legacy `Content` へフォールバックせずビルドを失敗させる。対象は network error / timeout / 429 / 5xx / 壊れた応答 / JSON・スキーマの不一致 / ページネーション途中の失敗 / 子ブロック取得の失敗。

握り潰すと、Notion の一時的な障害のたびに移行済み記事が黙って古い本文へ戻り、しかもビルドは成功するので誰も気づけない。Vercel は成功したビルドにだけ本番エイリアスを張るので、落とせば直前の正常なデプロイがそのまま残る。

フォールバックしてよいのは、**取得そのものが正常に完了し、本文が意味的に空だと判断できた場合だけ**。

## D-36 — 本文が空であることの定義

「ブロックが 1 件以上ある」を本文ありの条件にしない。

- ブロック 0 件 → 空
- 空 paragraph だけ → 空
- 空白のみの paragraph だけ → 空
- divider / image / equation / table / code など、テキスト以外に意味がある種別を含む → 空ではない
- 未知の種別、判定できない形の応答 → 空ではない（本文ありに倒す）

空と判定した結果は legacy へ戻る方向なので、迷ったら「空ではない」と言う方が安全側になる。

## D-37 — Notion API version は本文移行と分けて上げる

本文 source の移行（Issue #4）では `Notion-Version: 2022-06-28` を変えない。API version の更新は Issue #14 で単独で扱う。content model の移行と API version の移行を同じ変更に混ぜると、出力が変わった原因を切り分けられなくなる。

## D-38 — 生の Notion ブロックと ArticleDocument を分ける

Notion API の block JSON を Astro コンポーネントへ直接渡さない。`src/lib/notion-normalize.ts` だけが Notion の形を知り、そこから先へは `src/lib/article-document.ts` の型付きモデル（`ArticleDocument` / `ArticleBlock` / `ArticleRichText`）だけを渡す。

生ブロックを持ち回すと、(a) コンポーネントが `'paragraph' in block` のような API 形状の判定を持ち始め、(b) Notion の API バージョンを上げた時点（Issue #14）で描画側が壊れ、(c) 未対応のブロックが `undefined` を辿って静かに消える。

`ArticleContentSource` の `notion-page` も生ブロックではなく `ArticleDocument` を持つ。

## D-39 — 未対応ブロックは fail closed

未知・未対応の Notion ブロックと rich text 種別、壊れたペイロードは例外にする。`null` を返して読み飛ばさない。

黙って飛ばすと、図や数式や表が丸ごと抜けた記事が「正常にビルドできた記事」として公開される。診断にはブロック種別・記事 slug・Notion ページ ID・ブロック ID を出す。

子を置く場所が無い種別（paragraph / heading など）に子ブロックが付いていた場合も、子の内容が失われるので落とす。

## D-40 — legacy renderer と page-body renderer を並行して持つ

legacy `Content` は従来どおり `marked` + `set:html` で描く。ページ本文は型付きコンポーネントで描く。両者を 1 つの経路へ統合しない。

legacy は HTML 文字列であってブロックの木ではなく、無理に同じモデルへ載せると既存 15 本超の本文の描画結果が変わる。移行が終わるまで 2 経路を並存させる。

新しい renderer では文字列を組み立てて `set:html` しない。Astro の通常描画に載せることで、本文中の `<` `&` `"` のエスケープ漏れが起きえない状態にする。

## D-41 — 意味情報は保持し、描画だけを後続へ送る

画像・数式・table は Issue #5 で型付きノードまで作り、描画は #6 / #7 へ送る。

- 画像は Notion ホストの署名付き URL と external を型で区別して持つ。**署名付き URL を `<img src>` として出力しない**（Issue #6 でローカル化する）
- インライン数式・数式ブロックは expression をそのまま持つ。`$x^2$` のような文字列へ潰すと数式だった事実が失われ、#7 で正規表現から推測し直すことになる
- table はヘッダ情報・行・セルの rich text を保持する

描画できないノードに当たったら、空で描かずに落とす。

## D-42 — ページ本文の safety guard は #6 まで残す

Issue #5 で `src/pages/posts/[slug].astro` の暫定 throw は renderer に置き換わったが、`assertPageBodySourcesAreGuarded` は残す。ページ本文には URL / 画像の不変条件（D-13 / D-19 / D-15）がまだ掛かっていないため。

#6 では検査を実装して結線し、この guard を **置き換えて削除する**。`PAGE_BODY_INVARIANTS_IMPLEMENTED` を `true` にするだけの差分は差し戻す。検査が無いまま guard が黙る状態になるため。

### #6 で必ず確認する URL の形

Issue #5 の `safeHref` が見るのは **スキームの安全性だけ**で、ホストは見ていない。自サイト参照の判定は #6 の担当なので、実装時に次の形を必ず検証する。

- protocol-relative URL … `//blog.florigen.ai/...` / `//evil.example.com/...`
- backslash 形式 … `\\blog.florigen.ai/...` / `\\evil.example.com/...`

  この 2 つはスキームを持たないため `safeHref` は「相対パス」と分類して素通しする。しかしブラウザは `https://blog.florigen.ai/posts/x` を基準に解決すると外部オリジンへ飛ばす（実測）。ホスト判定を絶対 URL だけに限ると取りこぼす。
- Notion の page mention … `www.notion.so`

  現行の `SELF_HOSTS` には `app.notion.com` しか入っていない。ページメンションの href は `www.notion.so` になるため、`notion.so` を対象に加えるか判断する。
- 既存の `app.notion.com` の扱い（D-13）
- 自サイトを指す絶対 URL 全般
- `/posts/<Notion の UUID>`
