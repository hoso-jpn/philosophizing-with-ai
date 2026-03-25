// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel/static'; // 追加

export default defineConfig({
  site: 'https://philosophizing-with-ai.vercel.app',
  output: 'static', // 静的サイトとしてビルド
  integrations: [mdx(), sitemap()],
  adapter: vercel(), // これによりビルド成果物の配置がVercel最適化されます
});