import { getInsights } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { waitUntil } from "@vercel/functions";
import { recordOperationalEvent } from "../lib/operationalEvents.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const fresh = ["1", "true", "yes", "on"].includes(String(request.query.fresh || "").toLowerCase());
  response.setHeader("Cache-Control", "no-store");
  // Bound forced upstream refreshes while ordinary reads reuse the cache.
  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-insights",
    limit: 40,
    windowMs: 60 * 60 * 1000,
    message: "Too many refreshes in a row. Give it a minute and try again."
  })) {
    return;
  }

  try {
    const payload = await getInsights(request.query, undefined, { waitUntil });
    if (payload.coverage.failedRegions.length) waitUntil(recordOperationalEvent({ route: "insights", category: "source" }));
    if (!fresh && !payload.coverage.failedRegions.length) {
      response.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    }
    response.status(200).json(payload);
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) waitUntil(recordOperationalEvent({ route: "insights", category: "source", httpStatus: error.statusCode || 502 }));
    response.status(error.statusCode || 502).json({
      error: "Unable to build insights.",
      detail: error.message
    });
  }
}
