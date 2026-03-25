import { saveImageLocally } from './download-image';

// 1. 記事一覧を取得する関数
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
        filter: { property: "Published", checkbox: { equals: true } },
        sorts: [{ property: "Date", direction: "ascending" }],
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();

    return await Promise.all(data.results.map(async (page: any) => {
      const props = page.properties || {};
      const namePrefix = props["名前"]?.title?.[0]?.plain_text || "";
      const titleText = props.Title?.rich_text?.[0]?.plain_text || "";
      const combinedTitle = (namePrefix && titleText) ? `${namePrefix}；${titleText}` : (titleText || namePrefix || "無題");

      const rawHeroImage = props.HeroImage?.files?.[0]?.file?.url || props.HeroImage?.files?.[0]?.external?.url || null;
      let finalHeroImage = rawHeroImage;
      if (rawHeroImage) {
        finalHeroImage = await saveImageLocally(rawHeroImage, page.id);
      }

      return {
        id: page.id,
        title: combinedTitle,
        slug: props.Slug?.rich_text?.[0]?.plain_text || "",
        date: props.Date?.date?.start || "",
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: finalHeroImage,
      };
    }));
  } catch (error) {
    console.error("getPosts 通信エラー:", error);
    return [];
  }
}

// 2. 記事の詳細（メタデータ）を取得する関数
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
    if (!response.ok) return null;

    const page = await response.json();
    const props = page.properties || {};

    const namePrefix = props["名前"]?.title?.[0]?.plain_text || "";
    const titleText = props.Title?.rich_text?.[0]?.plain_text || "";
    const combinedTitle = (namePrefix && titleText) ? `${namePrefix}；${titleText}` : (titleText || namePrefix || "無題");

    const rawHeroImage = props.HeroImage?.files?.[0]?.file?.url || props.HeroImage?.files?.[0]?.external?.url || null;
    let finalHeroImage = rawHeroImage;
    if (rawHeroImage) {
      finalHeroImage = await saveImageLocally(rawHeroImage, page.id);
    }

    return {
      ...page,
      data: {
        title: combinedTitle,
        pubDate: props.Date?.date?.start ? new Date(props.Date.date.start) : new Date(),
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        tags: props.Tags?.multi_select?.map((tag: any) => tag.name) || [],
        heroImage: finalHeroImage,
      }
    };
  } catch (error) {
    console.error("getPostPage 通信エラー:", error);
    return null;
  }
}

// 3. 記事の本文（ブロック）を取得する関数
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