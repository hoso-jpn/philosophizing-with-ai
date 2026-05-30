const prerender = false;
const POST = async ({ request }) => {
  try {
    console.log("--- New Webhook Request ---");
    console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers), null, 2));
    const rawBody = await request.text();
    console.log("Raw Body:", rawBody);
    const body = JSON.parse(rawBody);
    if (body.type === "url_verification" && body.challenge) {
      console.log("Received Notion URL verification challenge. Responding with challenge.");
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
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
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    POST,
    prerender
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
