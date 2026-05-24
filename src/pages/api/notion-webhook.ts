// src/pages/api/notion-webhook.ts
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        // Log headers for debugging
        console.log("--- New Webhook Request ---");
        console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers), null, 2));

        // Read the body as text for logging
        const rawBody = await request.text();
        console.log("Raw Body:", rawBody);

        // Parse the body as JSON
        const body = JSON.parse(rawBody);

        // 1. Handle Notion's "url_verification" challenge
        if (body.type === "url_verification" && body.challenge) {
            console.log("Received Notion URL verification challenge. Responding with challenge.");
            return new Response(JSON.stringify({ challenge: body.challenge }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2. Handle actual updates by triggering a Vercel build
        console.log("Received Notion update (or other request). Triggering Vercel build...");

        const vercelDeployHookUrl = "https://api.vercel.com/v1/integrations/deploy/prj_NLlTHQaEousQs5Qvbnm65fDxkHYm/oJlRJcS0Nn";

        const vResponse = await fetch(vercelDeployHookUrl, {
            method: "POST"
        });

        if (!vResponse.ok) {
            const errorText = await vResponse.text();
            console.error(`Vercel Deploy Hook failed with status: ${vResponse.status}`, errorText);
            throw new Error(`Vercel Deploy Hook failed with status: ${vResponse.status}`);
        }

        console.log("Successfully triggered Vercel build.");
        return new Response(JSON.stringify({ message: "Successfully triggered Vercel build" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error: any) {
        console.error("Webhook processing error:", error.message);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};
