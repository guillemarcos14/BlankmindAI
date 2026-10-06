import assistant from "./assistant-app.js";

// Same authenticated, leased transaction as JSON. Drafts never contain native
// actions. Only the final persisted envelope can trigger client execution.
export default async function handler(request, context) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const body = await request.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch (_) { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (parsed?.action !== "send") return Response.json({ error: "unsupported_action" }, { status: 400 });
  const event = { httpMethod: "POST", headers: Object.fromEntries(request.headers), body };
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream({
    start(controller) {
      const emit = value => {
        if (disconnected) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); }
        catch (_) { disconnected = true; }
      };
      emit({ type: "start", turn_id: parsed.turn_id });
      const heartbeat = setInterval(() => emit({ type: "keepalive" }), 5000);
      const transaction = assistant.handler(event, null, { onDraft: text => emit({ type: "draft", turn_id: parsed.turn_id, text }) })
        .then(result => emit({ type: "result", status: result.statusCode, body: JSON.parse(result.body) }))
        .catch(() => emit({ type: "result", status: 503, body: { error: "assistant_app_unavailable" } }))
        .finally(() => {
          clearInterval(heartbeat);
          if (!disconnected) controller.close();
        });
      context?.waitUntil?.(transaction);
    },
    // Finish the durable transaction even if the iPhone disconnects. Status
    // recovery reuses the same UUID; it cannot repeat an already queued action.
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
