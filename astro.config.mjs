import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel'; // 末尾に /serverless は付けない

import { assertNoRemoteImagesInOutput, copyDownloadedImages } from './astro-integrations.mjs';

export default defineConfig({
    site: 'https://blog.florigen.ai',
    // 記事はビルド時に静的生成する（Notion への問い合わせはビルド時だけ）。
    // アダプタは残す。src/pages/api/notion-webhook.ts だけが prerender = false で
    // サーバ上に残り、Notion からの webhook を受ける。
    output: 'static',

    // 現在インデックスされている本番 URL は **末尾スラッシュ無し**
    // （実測: canonical = https://blog.florigen.ai/posts/determinism-free-will-ai）。
    // 既定のまま SSG 化すると build.format='directory' が /posts/<slug>/ を生み、
    // 全記事の URL が変わって検索評価を失う。
    //
    // trailingSlash: 'never' を指定すると、@astrojs/vercel が
    // .vercel/output/config.json へ 308 のリダイレクトルートを書く（実測）:
    //   { "src": "^/(.*)/$", "headers": { "Location": "/$1" }, "status": 308 }
    //
    // build.format は指定しない。**アダプタが 'directory' に強制する**ため
    // （node_modules/@astrojs/vercel/dist/index.js の updateConfig）、'file' を
    // 書いても効かない。出力は <slug>/index.html のままで、URL の正規化は
    // 上のリダイレクトルートが担う。
    trailingSlash: 'never',

    integrations: [
        mdx(),
        copyDownloadedImages(),
        assertNoRemoteImagesInOutput(),
    ],
    adapter: vercel(),
});
