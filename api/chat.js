import { chatWithBirds } from "../lib/ebirdCore.js";
import { enforceChatAdmission } from "../lib/chatAdmission.js";
import { waitUntil } from "@vercel/functions";
import { recordOperationalEvent } from "../lib/operationalEvents.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!Array.isArray(request.body?.messages) || !request.body.messages.some((message) =>
    message?.role === "user" && typeof message.content === "string" && message.content.trim())) {
    return response.status(400).json({ error: "Ask a question to start." });
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const onClose = () => { if (!response.writableEnded) cancel(); };
  request.once?.("aborted", cancel);
  response.once?.("close", onClose);
  if (request.aborted) cancel();
  try {
    if (controller.signal.aborted) return;
    if (!await enforceChatAdmission(request, response, { signal: controller.signal })) return;
    if (controller.signal.aborted) return;
    const payload = await chatWithBirds(request.body || {}, undefined, { signal: controller.signal });
    if (controller.signal.aborted) return;
    response.status(200).json(payload);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.statusCode === 503) response.setHeader("Retry-After", "15");
    if (!error.statusCode || error.statusCode >= 500) {
      waitUntil(recordOperationalEvent({ route: "chat", httpStatus: error.statusCode || 502,
        category: error.code === "admission_unavailable" ? "admission" : error.statusCode === 504 ? "timeout" : "source" }));
    }
    response.status(error.statusCode || 502).json({
      error: error.message || "Chat failed.",
    });
  } finally {
    request.off?.("aborted", cancel);
    response.off?.("close", onClose);
  }
}
