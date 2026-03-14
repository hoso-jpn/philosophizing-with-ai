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
        filter: {
          property: "Published",
          checkbox: { equals: true },
        },
        sorts: [
          { property: "Date", direction: "ascending" },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Notion APIエラー:", errorData);
      return [];
    }

    const data = await response.json();

    // --- ここから：扱いやすいようにデータを整理（整形）して返す ---
    return data.results.map((page: any) => {
      return {
        id: page.id,
        title: page.properties.Title?.title[0]?.plain_text || "無題",
        slug: page.properties.Slug?.rich_text[0]?.plain_text || "",
        date: page.properties.Date?.date?.start || "",
        description: page.properties.Description?.rich_text[0]?.plain_text || "",
        // Tagsを取得し、文字列の配列（ ["AI", "哲学"] のような形）に変換
        tags: page.properties.Tags?.multi_select.map((tag: any) => tag.name) || [],
        heroImage: page.properties.HeroImage?.url || null, // もしあれば
      };
    });
  } catch (error) {
    console.error("通信エラー:", error);
    return [];
  }
}

export async function getPostContent(pageId: string) {
  const auth = import.meta.env.NOTION_API_KEY;
  try {
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
    const page = await response.json();
    
    // 詳細ページ用にもデータを整形
    return {
      ...page,
      data: {
        title: page.properties.Title?.title[0]?.plain_text,
        pubDate: new Date(page.properties.Date?.date?.start),
        description: page.properties.Description?.rich_text[0]?.plain_text,
        tags: page.properties.Tags?.multi_select.map((tag: any) => tag.name) || [],
        heroImage: page.properties.HeroImage?.url || null,
      }
    };
  } catch (error) {
    return null;
  }
}