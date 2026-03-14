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

    if (!response.ok) return [];

    const data = await response.json();

    return data.results.map((page: any) => {
      // 安全にプロパティを取得するための補助変数
      const props = page.properties;
      
      return {
        id: page.id,
        // Notionの列名が「名前」か「Title」のどちらかにある方を採用
        title: (props.名前 || props.Title)?.title?.[0]?.plain_text || "無題",
        slug: props.Slug?.rich_text?.[0]?.plain_text || "",
        date: props.Date?.date?.start || "",
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        // Notion側の列名が「Tags」でも、プログラム内では小文字の「tags」として書き出す
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: props.HeroImage?.url || props.Cover?.url || null,
      };
    });
  } catch (error) {
    console.error("通信エラー:", error);
    return [];
  }
}

// ... (getPostContent はそのままでOK) ...

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
    const props = page.properties;
    
    return {
      ...page,
      data: {
        title: (props.名前 || props.Title)?.title?.[0]?.plain_text || "無題",
        pubDate: props.Date?.date?.start ? new Date(props.Date.date.start) : new Date(),
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        // ここも小文字の tags に統一
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: props.HeroImage?.url || null,
      }
    };
  } catch (error) {
    return null;
  }
}