// src/pages/api/notion-webhook.ts
import type { APIRoute } from 'astro';

// このエンドポイントをサーバーサイドで動かすための設定（hybridモードの場合に必要）
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();

        // --------------------------------------------------------
        // 1. Notionからの最初の一回限りの「チャレンジ認証」を処理する
        // --------------------------------------------------------
        if (body.type === "url_verification" && body.challenge) {
            console.log("Notionチャレンジ認証を受信しました。");
            return new Response(JSON.stringify({ challenge: body.challenge }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // --------------------------------------------------------
        // 2. 認証通過後、Notionのページが更新されたときの自動ビルド処理
        // --------------------------------------------------------
        console.log("Notionからの更新通知を検知。Vercelのビルドを開始します...");

        // あなたがVercelで発行したDeploy HookのURLを指定
        const vercelDeployHookUrl = "https://api.vercel.com/v1/integrations/deploy/prj_NLlTHQaEousQs5Qvbnm65fDxkHYm/oJlRJcS0Nn";

        const vResponse = await fetch(vercelDeployHookUrl, {
            method: "POST"
        });

        if (!vResponse.ok) {
            throw new Error(`Vercel Deploy Hook failed with status: ${vResponse.status}`);
        }

        return new Response(JSON.stringify({ message: "Successfully triggered Vercel build" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Webhook error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};
