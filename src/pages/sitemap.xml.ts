import type { APIRoute } from 'astro';
import { getPostsForSitemap } from '../lib/notion';

const SITE = 'https://philosophizing-with-ai.vercel.app';

type SitemapEntry = { url: string; priority: string; changefreq: string; lastmod?: string };

const staticPages: SitemapEntry[] = [
    { url: `${SITE}/`,     priority: '1.0', changefreq: 'daily' },
    { url: `${SITE}/blog`, priority: '0.9', changefreq: 'daily' },
    { url: `${SITE}/about`, priority: '0.8', changefreq: 'monthly' },
];

export const GET: APIRoute = async () => {
    const posts = await getPostsForSitemap();

    const postEntries: SitemapEntry[] = posts.map((post) => ({
        url: `${SITE}/posts/${post.id}`,
        lastmod: post.date ? post.date.slice(0, 10) : undefined,
        priority: '0.8',
        changefreq: 'weekly',
    }));

    const uniqueTags = [...new Set(posts.flatMap((p) => p.tags))];
    const tagEntries: SitemapEntry[] = uniqueTags.map((tag) => ({
        url: `${SITE}/tags/${encodeURIComponent(tag)}`,
        priority: '0.6',
        changefreq: 'weekly',
    }));

    const allEntries = [...staticPages, ...postEntries, ...tagEntries];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allEntries.map((entry) => `  <url>
    <loc>${entry.url}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    return new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
    });
};
