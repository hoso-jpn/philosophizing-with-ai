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
      const props = page.properties || {};
      
      return {
        id: page.id,
        // Title列(rich_text)か名前列(title)のどちらかから取得
        title: props.Title?.rich_text?.[0]?.plain_text || 
               props.名前?.title?.[0]?.plain_text || 
               "無題",
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
        // 詳細ページ用も Title(rich_text) または 名前(title) を見るように修正
        title: props.Title?.rich_text?.[0]?.plain_text || 
               props.名前?.title?.[0]?.plain_text || 
               "無題",
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