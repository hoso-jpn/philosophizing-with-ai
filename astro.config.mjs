// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/static'; // Vercel用の静的アダプターをインポート

// https://astro.build/config
export default defineConfig({
    site: 'https://philosophizing-with-ai.vercel.app', // あなたのサイトURLに変更
    output: 'static', // 明示的に静的モードを指定
    integrations: [mdx(), sitemap()],
    adapter: vercel(), // Vercelアダプターを有効化
});