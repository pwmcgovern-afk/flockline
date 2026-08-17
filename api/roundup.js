import { getWeeklyRoundup } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const fresh = ["1", "true", "yes", "on"].includes(
    String(request.query.fresh || "").toLowerCase()
  );
  response.setHeader(
    "Cache-Control",
    fresh ? "no-store" : "s-maxage=3600, stale-while-revalidate=21600"
  );

  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-roundup",
    limit: 40,
    windowMs: 60 * 60 * 1000,
    message: "Too many roundups in a row. Give it a minute and try again."
  })) {
    return;
  }

  try {
    response.status(200).json(await getWeeklyRoundup(request.query));
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.statusCode ? error.message : "Unable to build the weekly roundup.",
      detail: error.statusCode ? undefined : error.message
    });
  }
}
