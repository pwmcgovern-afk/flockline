import { chatWithBirds } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export default async function handler(request, response) {
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

  try {
    const payload = await chatWithBirds(request.body || {});
    // Conversations are dynamic, so this response must never be cached.
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.message || "Chat failed.",
    });
  }
}
