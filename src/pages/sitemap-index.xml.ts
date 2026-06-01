import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
    // ここに、検索エンジンに見せたいあなたのサイトの全URLを配列で書きます
    const pages = [
        'https://philosophizing-with-ai.vercel.app/',
        'https://philosophizing-with-ai.vercel.app/about',
        'https://philosophizing-with-ai.vercel.app/blog',
        // もしすでに個別のブログ記事のURL（例: /blog/article-1 など）が固定であれば、ここに追加します
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${pages
            .map(
                (url) => `
  <url>
    <loc>${url}</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`
            )
            .join('')}
</urlset>`.trim();

    return new Response(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/xml',
        },
    });
};
