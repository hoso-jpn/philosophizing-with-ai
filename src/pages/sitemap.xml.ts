import type { APIRoute } from 'astro';
import { getPostsForSitemap } from '../lib/notion';
import { getSlugFromTag } from '../lib/tag-slugs';

// 💡 これにより、ビルド時にNotionからデータを取得し、静的なsitemap.xmlが生成されるようになります
export const prerender = true;

const SITE = 'https://philosophizing-with-ai.vercel.app';

type SitemapEntry = { url: string; priority: string; changefreq: string; lastmod?: string };

const staticPages: SitemapEntry[] = [
    { url: `${SITE}/`, priority: '1.0', changefreq: 'daily' },
    { url: `${SITE}/blog`, priority: '0.9', changefreq: 'daily' },
    { url: `${SITE}/about`, priority: '0.8', changefreq: 'monthly' },
];

export const GET: APIRoute = async () => {
    // 1. Notionから記事一覧を取得（ビルド時に1度だけ実行されます）
    const posts = await getPostsForSitemap();

    // 2. 記事ページのURLエントリーを生成
    const postEntries: SitemapEntry[] = posts.map((post) => ({
        url: `${SITE}/posts/${post.slug || post.id}`,
        lastmod: post.date ? post.date.slice(0, 10) : undefined,
        priority: '0.8',
        changefreq: 'weekly',
    }));

    // 3. タグページのURLエントリーを生成（重複排除）
    const uniqueTags = [...new Set(posts.flatMap((p) => p.tags))];
    const tagEntries: SitemapEntry[] = uniqueTags.map((tag) => ({
        url: `${SITE}/tags/${getSlugFromTag(tag)}`,
        priority: '0.6',
        changefreq: 'weekly',
    }));

    // 4. すべてのエントリーを結合
    const allEntries = [...staticPages, ...postEntries, ...tagEntries];

    // 5. XML文字列を構築
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allEntries.map((entry) => `  <url>
    <loc>${entry.url}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    // 6. レンスポンスを返却
    return new Response(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=0, s-maxage=3600',
        },
    });
};
