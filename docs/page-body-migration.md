# Page body migration

## 内部リンクの保持

Notion は `[label](/posts/slug)` の保存時に `https://app.notion.com/posts/slug`
を補うことがある。記事移行でリンクを削除すると、参考記事への導線が失われる。

ページ本文を取得した後、URL検査より前に、この表現だけを `/posts/slug` に戻す。
対象は同じビルドで取得した公開記事の slug に完全一致するリンクに限る。
query / fragment / 表示テキスト / 装飾は保持し、キャッシュされた元本文は変更しない。
これはNotionの保存表現の変換であり、slugのtypo・UUID・未知の記事・他ホストの補正は行わない。
legacy Content と画像URLの検査は従来どおりで、未解決の違反はビルドを止める。

AIと哲学01の移行時に通常テキストへ変更されていた「AIと哲学11」へのリンクは、
この変換によりページ本文でも保持できる。legacy Content はrollback用に残す。

## 段階移行

1. Notionから最新のPublished、Slug、Content、ページ本文を読み直す。CSVは照合用とし、古い本文を上書きしない。
2. 空のページ本文へ1記事だけ移す。Contentと公開メタデータを保持する。
3. 再取得して本文・参照先・見出し・リスト・装飾を確認する。
4. allowlistへ対象slugだけ追加したPRを作成する。
5. CIと実データを使うVercel Previewを確認する。desktop/mobileの目視確認ができていない場合は、その旨をPRへ明記する。
6. 問題があれば対象slugをallowlistから除去してContentへ戻す。次の記事は小単位で進める。
