import { defineConfig } from 'astro/config';

import { assertLocalImagesExist, assertNoRemoteImagesInOutput } from '../../astro-integrations.mjs';

export default defineConfig({
  site: 'https://blog.florigen.ai',
  output: 'static',
  trailingSlash: 'never',
  srcDir: new URL('./src/', import.meta.url).pathname,
  publicDir: new URL('./public/', import.meta.url).pathname,
  outDir: new URL('./dist/', import.meta.url).pathname,
  cacheDir: new URL('./.astro/', import.meta.url).pathname,
  integrations: [assertNoRemoteImagesInOutput(), assertLocalImagesExist()],
});
