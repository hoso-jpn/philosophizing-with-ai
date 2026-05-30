async function saveImageLocally(url, _id) {
  return url;
}

async function getPosts() {
  const auth = undefined                              ;
  const databaseId = undefined                                  ;
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${auth}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: { property: "Published", checkbox: { equals: true } },
        sorts: [{ property: "Date", direction: "ascending" }]
      })
    });
    if (!response.ok) return [];
    const data = await response.json();
    return await Promise.all(data.results.map(async (page) => {
      const props = page.properties || {};
      const namePrefix = props["名前"]?.title?.[0]?.plain_text || "";
      const titleText = props.Title?.rich_text?.[0]?.plain_text || "";
      const combinedTitle = namePrefix && titleText ? `${namePrefix}；${titleText}` : titleText || namePrefix || "無題";
      const tagsProp = props.Tags || props["タグ"];
      let tags = [];
      if (tagsProp) {
        if (Array.isArray(tagsProp.multi_select)) {
          tags = tagsProp.multi_select.map((tag) => tag?.name).filter(Boolean);
        } else if (Array.isArray(tagsProp.rich_text) && tagsProp.rich_text.length > 0) {
          const text = tagsProp.rich_text[0]?.plain_text;
          if (typeof text === "string") {
            tags = text.split(/[、, ]/).map((s) => s.trim()).filter(Boolean);
          }
        }
      }
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
        tags,
        // 修正後のタグを反映
        heroImage: finalHeroImage
      };
    }));
  } catch (error) {
    console.error("getPosts 通信エラー:", error);
    return [];
  }
}
async function getPostPage(pageId) {
  const auth = undefined                              ;
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${auth}`,
        "Notion-Version": "2022-06-28"
      }
    });
    if (!response.ok) return null;
    const page = await response.json();
    const props = page.properties || {};
    const namePrefix = props["名前"]?.title?.[0]?.plain_text || "";
    const titleText = props.Title?.rich_text?.[0]?.plain_text || "";
    const combinedTitle = namePrefix && titleText ? `${namePrefix}；${titleText}` : titleText || namePrefix || "無題";
    const tagsProp = props.Tags || props["タグ"];
    let tags = [];
    if (tagsProp) {
      if (Array.isArray(tagsProp.multi_select)) {
        tags = tagsProp.multi_select.map((tag) => tag?.name).filter(Boolean);
      } else if (Array.isArray(tagsProp.rich_text) && tagsProp.rich_text.length > 0) {
        const text = tagsProp.rich_text[0]?.plain_text;
        if (typeof text === "string") {
          tags = text.split(/[、, ]/).map((s) => s.trim()).filter(Boolean);
        }
      }
    }
    const rawHeroImage = props.HeroImage?.files?.[0]?.file?.url || props.HeroImage?.files?.[0]?.external?.url || null;
    let finalHeroImage = rawHeroImage;
    if (rawHeroImage) {
      finalHeroImage = await saveImageLocally(rawHeroImage, page.id);
    }
    return {
      ...page,
      data: {
        title: combinedTitle,
        pubDate: props.Date?.date?.start ? new Date(props.Date.date.start) : /* @__PURE__ */ new Date(),
        description: props.Description?.rich_text?.[0]?.plain_text || "",
        tags,
        heroImage: finalHeroImage
      }
    };
  } catch (error) {
    console.error("getPostPage 通信エラー:", error);
    return null;
  }
}

export { getPostPage as a, getPosts as g };
