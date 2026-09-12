# 記事コメント欄

Issue #9。本文はSSGのまま、giscusを記事末尾の独立コンポーネントで読み込む。
pathnameによる対応付け、日本語、dark theme、reactions、iframe lazy loadingを使う。
タイトル変更は対応付けに影響しない。公開後のslug変更はDiscussionの移行も必要になる。

## 現在の有効化状態

2026-09-12に所有者側の初期設定とPreviewでの実サービス確認まで完了した。

- GitHub Discussions: 有効化済み
- giscus GitHub App: `hoso-jpn/philosophizing-with-ai` へのアクセス許可済み
- category: `Announcements`
- repository node ID: `R_kgDORl9JSg`
- category node ID: `DIC_kwDORl9JSs4DFadR`
- Vercel Preview: `PUBLIC_GISCUS_CATEGORY` / `PUBLIC_GISCUS_CATEGORY_ID` を設定済み
- Vercel Production: 同じ2変数を設定済み。PR merge後のProduction deploymentで最終確認する

Previewでは既存記事からGitHubアカウントでログインし、コメント投稿とreactionを実施した。
`posts/capitalism-duty-and-freedom` に対応するDiscussionが `Announcements` にgiscus Botによって自動生成され、投稿内容が同期されることを確認済み。

## 初期設定・再設定手順

新しいリポジトリで有効化する場合、またはgiscus設定を作り直す場合は以下を行う。

1. Repository Settings → General → FeaturesでDiscussionsを有効化する。
2. giscus GitHub Appに対象リポジトリへのアクセスを許可する。
3. Announcements形式のcategoryを選ぶ、または作成する。
4. [giscus設定画面](https://giscus.app/ja)でrepositoryとcategoryを選ぶ。
5. 出力の `data-category` と `data-category-id` をそれぞれVercelの
   `PUBLIC_GISCUS_CATEGORY` / `PUBLIC_GISCUS_CATEGORY_ID` に設定する。
6. Previewで投稿・reactions・Discussion生成を確認してからProductionにも同じ値を設定する。

category IDは `DIC_` で始まるGraphQL node IDであり、数値のIDではない。
repository/categoryのnode IDは公開HTMLに必要な識別子で、API tokenではない。

## 設定前・障害時の動作

両変数が未設定ならsection/scriptを出さない。設定が片方だけ、またはIDが不正ならビルドを止める。
読み込みに失敗しても本文に影響せず、Discussionsへのリンクが残る。
JS無効時はnoscript案内を表示する。両変数を削除して再ビルドすればコメント欄を停止できる。

## 確認項目

- 既存記事で閲覧・投稿・reactionsが動くこと。モデレーションはDiscussions側で行う。
- 記事タイトルを変更しても同じpathnameが同じDiscussionを開くこと。
- desktop/mobile、JS無効、giscus遮断の各条件で本文が読めること。
- Previewからの投稿も同じpathnameのDiscussionへ入るため、検証投稿はテストと分かる内容にする。
- Production反映時はmerge後の本番記事でもコメント欄とDiscussion同期を再確認する。

CIでは設定ありの生成HTMLと設定なしの記事を検査する。実サービスでは2026-09-12にPreview投稿・reaction・Discussion自動生成まで確認済み。

出典: [giscus公式設定・導入要件](https://giscus.app/ja)
