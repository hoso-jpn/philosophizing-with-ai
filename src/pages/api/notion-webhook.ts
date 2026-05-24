// src/pages/api/notion-webhook.ts
import type { APIRoute } from 'astro';
import crypto from 'crypto';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const rawBody = await request.text();
        const timestamp = request.headers.get('x-notion-request-timestamp');
        const signature = request.headers.get('x-notion-signature-v1');
        const secret = import.meta.env.NOTION_WEBHOOK_SECRET;

        // First, check for the URL verification challenge, which doesn't need a signature
        try {
            const body = JSON.parse(rawBody);
            if (body.type === "url_verification" && body.challenge) {
                console.log("Received Notion URL verification challenge.");
                return new Response(JSON.stringify({ challenge: body.challenge }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        } catch (e) {
            // Not a JSON body or not a verification request, proceed to signature validation
            console.log("Not a URL verification request, proceeding with signature validation.");
        }


        // For all other requests, a valid signature is required.
        if (!timestamp || !signature || !secret) {
            console.warn("Missing signature, timestamp, or secret. Rejecting request.");
            return new Response(JSON.stringify({ error: "Missing signature information" }), { status: 401 });
        }

        const signedContent = `${timestamp}.${rawBody}`;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(signedContent)
            .digest('hex');

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            console.warn("Invalid signature. Rejecting request.");
            return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
        }

        // --- Signature is valid, proceed with build ---
        console.log("Received valid Notion update. Triggering Vercel build...");

        const vercelDeployHookUrl = "https://api.vercel.com/v1/integrations/deploy/prj_NLlTHQaEousQs5Qvbnm65fDxkHYm/oJlRJcS0Nn";

        const vResponse = await fetch(vercelDeployHookUrl, {
            method: "POST"
        });

        if (!vResponse.ok) {
            console.error(`Vercel Deploy Hook failed with status: ${vResponse.status}`, await vResponse.text());
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
