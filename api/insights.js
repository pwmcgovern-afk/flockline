import { getInsights } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export default async function handler(request, response) {
  const fresh = ["1", "true", "yes", "on"].includes(String(request.query.fresh || "").toLowerCase());
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
    response.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: "Unable to build insights.",
      detail: error.message
    });
  }
}
