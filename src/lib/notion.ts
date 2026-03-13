export async function getPosts() {
  const auth = import.meta.env.NOTION_API_KEY;
  const databaseId = import.meta.env.NOTION_DATABASE_ID;

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // 公開設定になっているものだけ取得
        filter: {
          property: "Published",
          checkbox: {
            equals: true,
          },
        },
        // 日付順に並べ替え
        sorts: [
          {
            property: "Date",
            direction: "ascending",
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Notion APIエラー:", errorData);
      return [];
    }

    const data = await response.json();
    return data.results;
  } catch (error) {
    console.error("通信エラー:", error);
    return [];
  }
}
export async function getPostContent(pageId: string) {
  const auth = import.meta.env.NOTION_API_KEY;

  try {
    // ページの本文（ブロック）を取得
    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) return [];
    const data = await response.json();
    return data.results;
  } catch (error) {
    console.error("本文取得エラー:", error);
    return [];
  }
}
// ページ（行）の詳細情報を取得する関数
export async function getPostPage(pageId: string) {
  const auth = import.meta.env.NOTION_API_KEY;
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth}`,
        'Notion-Version': '2022-06-28',
      },
    });
    return await response.json();
  } catch (error) {
    return null;
  }
}