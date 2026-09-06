import type { ArticleContentSource } from './content-source.ts';

/**
 * サイト全体で使う記事の型。
 * Notion の生プロパティをそのまま持ち回さず、必ずこの形に正規化してから使う。
 */

/**
 * Notion のページを検証した直後の記事。本文の source はまだ決まっていない。
 *
 * 本文 source の解決には Notion のページ本文の取得（非同期）が要るので、
 * プロパティの検証（parsePost）とは段を分けてある。
 */
export type ParsedPost = {
  /** Notion のページ ID */
  id: string;
  /** 表示用タイトル（「名前」＋区切り＋Title を連結したもの） */
  title: string;
  /** Notion の「名前」プロパティ。シリーズ接頭辞。例: "AIと実装01" */
  titlePrefix: string;
  /** Notion の Title プロパティ。本タイトル */
  titleBody: string;
  /** 明示的なシリーズ名。Notion 側に Series プロパティがある場合のみ入る */
  series: string | null;
  /** URL に使う slug。空にはならない（空ならビルドが失敗する） */
  slug: string;
  /** ISO8601 の日付文字列。時刻が付く行と付かない行がある */
  date: string;
  /** 記事概要。現状すべて空。Phase 6 で本文からの自動生成にフォールバックさせる */
  description: string;
  tags: string[];
  /** アイキャッチ画像の URL またはローカルパス。無ければ null */
  heroImage: string | null;
  /**
   * legacy `Content` プロパティ由来の本文。
   *
   * 名前に legacy と入れてあるのは、これが「記事の本文」ではなく
   * **本文 source の候補の 1 つ**でしかないため。取得パイプラインの中でだけ使う
   * （URL 検査・画像のローカル化・source 解決）。
   *
   * 移行対象（migration allowlist 内）の記事に限り空になりうる。
   * それ以外の記事で空ならビルドが失敗する。
   */
  legacyContent: string;
  published: boolean;
};

/**
 * 本文 source まで解決済みの記事。ページやフィードが受け取るのはこちら。
 *
 * **`legacyContent` を意図的に落としてある。** 残しておくと、ページ本文へ移行した
 * 記事でも古い legacy 本文が「普通の本文」として読める状態が続き、新しい
 * コンポーネントがうっかりそちらを描いてしまう。legacy 本文が要るのは
 * `contentSource.kind === 'legacy'` のときだけで、そのときは
 * `contentSource.content` に入っている。
 *
 * legacy へ戻したくなったら migration allowlist から slug を外す。次のビルドで
 * source 解決が legacy を選び直すので、本文データが失われることはない。
 */
export type Post = Omit<ParsedPost, 'legacyContent'> & {
  /** 本文の正本。描画側は必ずこれを見て分岐する */
  contentSource: ArticleContentSource;
};
