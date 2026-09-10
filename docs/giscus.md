# 記事コメント欄

Issue #9。本文はSSGのまま、giscusを記事末尾の独立コンポーネントで読み込む。
pathnameによる対応付け、日本語、dark theme、reactions、iframe lazy loadingを使う。
タイトル変更は対応付けに影響しない。公開後のslug変更はDiscussionの移行も必要になる。

## 有効化

2026-09-10の確認ではリポジトリのDiscussionsは無効。
GitHub接続の管理操作にはDiscussions設定とgiscus App導入が含まれないため、所有者が以下を行う。

1. Repository Settings → General → FeaturesでDiscussionsを有効化する。
2. giscus GitHub Appにこのリポジトリへのアクセスを許可する。
3. Announcements形式のcategoryを選ぶ、または作成する。
4. [giscus設定画面](https://giscus.app/ja)でrepositoryとcategoryを選ぶ。
5. 出力の `data-category` と `data-category-id` をそれぞれVercelの
   `PUBLIC_GISCUS_CATEGORY` / `PUBLIC_GISCUS_CATEGORY_ID` に設定する。
   Previewで検証後、Productionにも同じ値を設定し再ビルドする。

repositoryは `hoso-jpn/philosophizing-with-ai`、node IDは取得済みの `R_kgDORl9JSg` を使う。
category IDは `DIC_` で始まるGraphQL node IDであり、数値のIDではない。架空のIDを本番に設定しない。
これらは公開HTMLに必要な識別子で、API tokenは不要。

## 設定前・障害時の動作

両変数が未設定ならsection/scriptを出さない。設定が片方だけ、またはIDが不正ならビルドを止める。
読み込みに失敗しても本文に影響せず、Discussionsへのリンクが残る。
JS無効時はnoscript案内を表示する。両変数を削除して再ビルドすればコメント欄を停止できる。

## 有効化後の確認

- 既存記事で閲覧・投稿・reactionsが動くこと。モデレーションはDiscussions側で行う。
- 記事タイトルを変更しても同じpathnameが同じDiscussionを開くこと。
- desktop/mobile、JS無効、giscus遮断の各条件で本文が読めること。
- Previewからの投稿も同じpathnameのDiscussionへ入るため、検証投稿はテストと分かる内容にする。

CIでは設定ありの生成HTMLと設定なしの記事を検査する。実際の投稿確認は所有者設定後に実施する。

出典: [giscus公式設定・導入要件](https://giscus.app/ja)
