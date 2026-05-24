// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
    site: 'https://philosophizing-with-ai.vercel.app',
    // 'static' から 'hybrid' に変更（APIルートなどを部分的にサーバー駆動にするため）
    output: 'hybrid',
    integrations: [mdx(), sitemap()],
    adapter: vercel(),
    image: {
        // Notionのプロキシ経由とS3直リンクの両方を許可します
        domains: [
            'www.notion.so',
            's3.us-west-2.amazonaws.com',
            'prod-files-secure.s3.us-west-2.amazonaws.com'
        ],
    },
});
