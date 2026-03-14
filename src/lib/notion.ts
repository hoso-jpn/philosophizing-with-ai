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

    // 修正ポイント：mapを整理し、二重ループを解消
    return data.results.map((page: any) => {
      const props = page.properties || {};
      
      return {
        id: page.id,
        // 「名前」という日本語キーを使わず、Title か Name を安全に取得
        title: props.Title?.title?.[0]?.plain_text || 
               props.Name?.title?.[0]?.plain_text || "無題",
        slug: props.Slug?.rich_text?.[0]?.plain_text || "",
        date: props.Date?.date?.start || "",
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: props.HeroImage?.url || null,
      };
    });
  } catch (error) {
    console.error("通信エラー:", error);
    return [];
  }
}

// getPostContent はそのままでOK
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
    const props = page.properties || {};
    
    return {
      ...page,
      data: {
        // 修正ポイント：ここからも「名前」を排除
        title: props.Title?.title?.[0]?.plain_text || props.Name?.title?.[0]?.plain_text || "無題",
        pubDate: props.Date?.date?.start ? new Date(props.Date.date.start) : new Date(),
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: props.HeroImage?.url || null,
      }
    };
  } catch (error) {
    return null;
  }
}