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
  // Three an hour is well inside what one curious reader does in a single
  // sitting: change the region, change the window, re-run a couple of times and
  // the panel starts refusing. This ceiling is only here to stop a script from
  // running up the model bill, so put it where no human will ever reach it.
  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-insights",
    limit: 40,
    windowMs: 60 * 60 * 1000,
    message: "Too many refreshes in a row. Give it a minute and try again."
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
