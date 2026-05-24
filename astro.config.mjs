// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel/serverless'; // ★末尾に /serverless をつける

export default defineConfig({
    site: 'https://philosophizing-with-ai.vercel.app',
    output: 'hybrid', // ハイブリッドモード（APIを有効化）
    integrations: [mdx(), sitemap()],
    adapter: vercel({
        webAnalytics: { enabled: true } // 必要に応じて（空の vercel() でもOKです）
    }),
    image: {
        domains: [
            'www.notion.so',
            's3.us-west-2.amazonaws.com',
            'prod-files-secure.s3.us-west-2.amazonaws.com'
        ],
    },
});
