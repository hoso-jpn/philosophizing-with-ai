import { saveImageLocally } from './download-image';

function extractTags(tagsProp: any): string[] {
  if (!tagsProp) return [];
  if (Array.isArray(tagsProp.multi_select)) {
    return tagsProp.multi_select.map((tag: any) => tag?.name).filter(Boolean);
  }
  if (Array.isArray(tagsProp.rich_text) && tagsProp.rich_text.length > 0) {
    const text = tagsProp.rich_text[0]?.plain_text;
    if (typeof text === 'string') {
      return text.split(/[、, ]/).map((s: string) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// 1. 記事一覧を取得する関数
export async function getPosts() {
  const auth = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;

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
      
      // タイトル結合
      const namePrefix = props["名前"]?.title?.[0]?.plain_text || "";
      const titleText = props.Title?.rich_text?.[0]?.plain_text || "";
      const combinedTitle = (namePrefix && titleText) ? `${namePrefix}；${titleText}` : (titleText || namePrefix || "無題");

      const tags = extractTags(props.Tags || props["タグ"]);

      // 画像保存
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
        tags: tags, // 修正後のタグを反映
        heroImage: finalHeroImage,
      };
    }));
  } catch (error) {
    console.error("getPosts 通信エラー:", error);
    return [];
  }
}

// 2. 記事の詳細を取得する関数
export async function getPostPage(pageId: string) {
  const auth = process.env.NOTION_API_KEY;
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

    const tags = extractTags(props.Tags || props["タグ"]);

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
        tags: tags,
        heroImage: finalHeroImage,
      }
    };
  } catch (error) {
    console.error("getPostPage 通信エラー:", error);
    return null;
  }
}

// 4. slug から Notion ページ ID を取得
export async function getPostIdBySlug(slug: string): Promise<string | null> {
  const auth = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;

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
          and: [
            { property: "Published", checkbox: { equals: true } },
            { property: "Slug", rich_text: { equals: slug } },
          ],
        },
        page_size: 1,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;
    return data.results[0].id as string;
  } catch {
    return null;
  }
}

// 5. サイトマップ用: 画像ダウンロードなしで id / slug / tags / date のみ取得
export async function getPostsForSitemap(): Promise<{ id: string; slug: string; tags: string[]; date: string }[]> {
  const auth = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;

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
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();

    return data.results.map((page: any) => {
      const props = page.properties || {};

      const tags = extractTags(props.Tags || props["タグ"]);

      return {
        id: page.id,
        slug: props.Slug?.rich_text?.[0]?.plain_text || "",
        tags,
        date: props.Date?.date?.start || "",
      };
    });
  } catch {
    return [];
  }
}

// 3. 本文を取得（変更なし）
export async function getPostContent(pageId: string) {
  const auth = process.env.NOTION_API_KEY;
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