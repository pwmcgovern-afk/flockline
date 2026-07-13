import { getInsights } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const fresh = ["1", "true", "yes", "on"].includes(String(request.query.fresh || "").toLowerCase());
  response.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-insights",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    message: "Insights were refreshed recently. Please try again later."
  })) {
    return;
  }

  try {
    const payload = await getInsights(request.query);
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: "Unable to build insights.",
      detail: error.message
    });
  }
}
