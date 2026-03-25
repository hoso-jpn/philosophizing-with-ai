// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel'; // 「/static」を消してこれだけにします

export default defineConfig({
  site: 'https://philosophizing-with-ai.vercel.app',
  output: 'static', 
  integrations: [mdx(), sitemap()],
  adapter: vercel(), // ここはそのままでOKです
});