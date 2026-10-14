import { chatWithBirds } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!enforceRateLimit(request, response, {
    name: "chat",
    limit: 8,
    windowMs: 10 * 60 * 1000,
    message: "You have reached the Ask limit for now. Please try again in a few minutes."
  })) {
    return;
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const onClose = () => { if (!response.writableEnded) cancel(); };
  request.once?.("aborted", cancel);
  response.once?.("close", onClose);
  if (request.aborted) cancel();
  try {
    const payload = await chatWithBirds(request.body || {}, undefined, { signal: controller.signal });
    if (controller.signal.aborted) return;
    response.status(200).json(payload);
  } catch (error) {
    if (controller.signal.aborted) return;
    response.status(error.statusCode || 502).json({
      error: error.message || "Chat failed.",
    });
  } finally {
    request.off?.("aborted", cancel);
    response.off?.("close", onClose);
  }
}
