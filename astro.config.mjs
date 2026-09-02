import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel'; // 末尾に /serverless は付けない

export default defineConfig({
    site: 'https://blog.florigen.ai',
    output: 'server',
    integrations: [
        mdx(),
    ],
    adapter: vercel(),
});
