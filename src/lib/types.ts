/**
 * サイト全体で使う記事の型。
 * Notion の生プロパティをそのまま持ち回さず、必ずこの形に正規化してから使う。
 */
export type Post = {
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
  /** 本文の生テキスト。フォーマットは Phase 4 で判定する */
  content: string;
  published: boolean;
};
