import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel'; // 末尾に /serverless は付けない

export default defineConfig({
    site: 'https://philosophizing-with-ai.vercel.app',
    output: 'server',
    integrations: [
        mdx(),
    ],
    adapter: vercel(),
    image: {
        domains: [
            'www.notion.so',
            's3.us-west-2.amazonaws.com',
            'prod-files-secure.s3.us-west-2.amazonaws.com'
        ],
    },
});
