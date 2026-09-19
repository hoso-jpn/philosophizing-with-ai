# AIと哲学02の段階移行

Issue #13。PR #26でAIと哲学01と内部リンク保持の修正をマージした後の、1記事だけの移行。

| 項目 | 記録 |
| --- | --- |
| 確認日 | 2026-09-10 |
| Slug | `ai-hard-problem-functionalism` |
| 最新Title | なぜ私は、他人に意識があると信じているのか――機能主義とAIの意識帰属 |
| 元データ | Notionの最新Content（更新前に再取得・一致確認） |
| 移行前のページ本文 | 空 |
| Content SHA-256 | `0aa81c3bf69e34d24ad3ecd0380a1c85d1a72aac360a561887561da193b08af4` |
| 元Content | 15,993文字。rollback用に変更せず保持 |
| 見出し | 23件 |
| リンク | 10件（内部3件・外部参考文献7件） |

添付CSVのTitle/Contentは改稿前だったため上書き元には使っていない。
最新Contentの `<br>` を改行、escaped quoteをnative quote、escaped anchorをnative linkへ移した。
画像・code・table・数式はこの移行本文には含まれない。

書き込み後に再取得し、Content / Published / Slug / Title / Dateが不変であることを確認した。
空白とNotionが補ったapp originを正規化すると、挿入したMarkdownと再取得したページ本文は一致する。
これは本文・Markdown装飾・参照先の保持確認であり、APIの生block数や見た目の同一性の実測ではない。

内部リンクは以下の公開記事を指す。PR #26で導入した完全一致の解決により、生成時は相対pathへ戻る。

- `/posts/determinism-free-will-ai`
- `/posts/beyond-multimodal-ai`
- `/posts/living-by-curiosity`

## PRでの確認

allowlistにこの1件だけを追加し、既存の完全一致・unknown-slug検査を更新する。
公開URL、SEOメタデータ、RSS/sitemap、seriesの順序は変更しない。
ローカルのunit test / typecheck / fixture build/outputと、PRのCI・実データを使うVercel buildを確認する。
desktop/mobileの目視確認は未実施。PRのPreviewで確認してから、次の記事の公開切替へ進む。

## Rollback

`src/lib/migration-allowlist.ts`からこのslugだけを除去する。
NotionのContentが保持されているため、他記事へ影響せずlegacy本文へ戻る。
AIと哲学03・04はこのPRの対象に含めない。
