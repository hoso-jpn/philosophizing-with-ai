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
    // trailingSlash: 'never'  … /posts/<slug>/ でのアクセスをスラッシュ無しへ寄せる
    // build.format: 'file'    … <slug>/index.html ではなく <slug>.html を出力する
    //
    // 両方を指定しないと足りない。'never' だけでは出力ファイルの形が directory の
    // ままで、ホスティング側がスラッシュ付きを正とみなす余地が残る。
    trailingSlash: 'never',
    build: {
        format: 'file',
    },

    integrations: [
        mdx(),
        copyDownloadedImages(),
        assertNoRemoteImagesInOutput(),
    ],
    adapter: vercel(),
});
