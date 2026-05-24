// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel'; // ★ /serverless は不要になりました

export default defineConfig({
    site: 'https://philosophizing-with-ai.vercel.app',

    // 1. Astro v5/v6でAPIを動かすには、server ではなく 'server' または 'hybrid' を指定
    output: 'hybrid',

    integrations: [mdx(), sitemap()],

    // 2. adapterの指定方法を修正。空の vercel() ではなく、明示的に関数として呼ぶ
    adapter: vercel(),

    image: {
        domains: [
            'www.notion.so',
            's3.us-west-2.amazonaws.com',
            'prod-files-secure.s3.us-west-2.amazonaws.com'
        ],
    },
});
