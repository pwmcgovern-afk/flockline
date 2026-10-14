import { getWeeklyRoundup } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { waitUntil } from "@vercel/functions";
import { recordOperationalEvent } from "../lib/operationalEvents.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const fresh = ["1", "true", "yes", "on"].includes(
    String(request.query.fresh || "").toLowerCase()
  );
  response.setHeader("Cache-Control", "no-store");

  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-roundup",
    limit: 40,
    windowMs: 60 * 60 * 1000,
    message: "Too many roundups in a row. Give it a minute and try again."
  })) {
    return;
  }

  try {
    const payload = await getWeeklyRoundup(request.query);
    if (payload.coverage.failedRegions.length || payload.coverage.retryableRegions?.length) {
      waitUntil(recordOperationalEvent({ route: "roundup", category: "source" }));
    }
    if (!fresh && !payload.coverage.failedRegions.length && !payload.coverage.retryableRegions?.length) {
      response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
    }
    response.status(200).json(payload);
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) waitUntil(recordOperationalEvent({ route: "roundup", category: "source", httpStatus: error.statusCode || 502 }));
    response.status(error.statusCode || 502).json({
      error: error.statusCode ? error.message : "Unable to build the weekly roundup.",
      detail: error.statusCode ? undefined : error.message
    });
  }
}
