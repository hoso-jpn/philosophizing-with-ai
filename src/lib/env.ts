/**
 * 環境変数の読み出し。
 *
 * Astro(Vite) は .env を読み込むが、その値が載るのは import.meta.env であって
 * process.env ではない。一方 Vercel はランタイム／ビルドの process.env にだけ値を入れる。
 * どちらの経路でも動くよう両方を見る。
 *
 * 欠けている場合は例外を投げる。以前は undefined のまま fetch に渡り、
 * Notion が 401 を返し、それを握り潰して空配列になり、「記事0本のサイト」が
 * 正常ビルド扱いで出来上がっていた。静かに空になる経路をここで塞ぐ。
 */
function resolve(name: string, viteValue: unknown): string {
  const nodeValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = typeof viteValue === 'string' && viteValue !== '' ? viteValue : nodeValue;

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `環境変数 ${name} が設定されていません。\n` +
        `  ローカル: リポジトリ直下に .env を用意してください（vercel env pull .env --environment=development）\n` +
        `  Vercel  : プロジェクトの Environment Variables に設定してください`,
    );
  }
  return value;
}

export function getNotionApiKey(): string {
  return resolve('NOTION_API_KEY', import.meta.env?.NOTION_API_KEY);
}

export function getNotionDatabaseId(): string {
  return resolve('NOTION_DATABASE_ID', import.meta.env?.NOTION_DATABASE_ID);
}

/**
 * 公開記事がこの本数を下回ったらビルドを止める下限値。
 * Notion のトークン失効・API 障害・プロパティ名変更はいずれも「取得0件」に化けるため、
 * 記事が消えたサイトが平然と本番へ出るのを防ぐ。
 *
 * 既定値は「現在の公開本数 15 に対して 2 本までの非公開を許容する」意味で 13。
 * 記事が増えたらこの値も上げること（毎ビルド、現在数と下限をログに出している）。
 * 一時的に下回らせたいときは環境変数 MIN_EXPECTED_POSTS で上書きする。
 */
export function getMinExpectedPosts(): number {
  const raw = import.meta.env?.MIN_EXPECTED_POSTS ?? process.env?.MIN_EXPECTED_POSTS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 13;
}
