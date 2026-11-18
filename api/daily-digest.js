import { waitUntil } from "@vercel/functions";
import { dailyDate, dailyDigestPath } from "../shared/dailyDigest.js";
import { ensureDailyDigest, getDailyDigest, listDailyDigests } from "../lib/dailyDigestArchive.js";
import { getInsights } from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";

export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed." });
  }
  try {
    if (request.method === "GET" && request.query.list === "1")
      return response.status(200).json({ issues: await listDailyDigests() });
    const body = request.method === "POST" ? request.body : request.query;
    const scopeId = String(body?.scope || "");
    const date = String(body?.date || dailyDate());
    const back = Number(body?.back ?? 1);
    if (!dailyDigestPath(scopeId, date, back) || date > dailyDate())
      return response.status(400).json({ error: "Choose a valid region, date, and window." });
    let snapshot;
    if (request.method === "POST") {
      if (!enforceRateLimit(request, response, { name: "daily-digest", limit: 12, windowMs: 60 * 60 * 1000, message: "Too many digest requests. Please try again later." })) return;
      snapshot = await ensureDailyDigest({ scopeId, date, back }, {
        build: (query) => getInsights(query, undefined, { waitUntil }),
      });
    } else snapshot = await getDailyDigest(scopeId, date, back);
    if (!snapshot) return response.status(404).json({ error: "No saved digest exists for this day." });
    return response.status(200).json(snapshot);
  } catch (error) {
    console.error("Daily digest request failed", error.message);
    return response.status(error.statusCode || 503).json({ error: error.statusCode === 404 ? error.message : "The daily digest could not be loaded. Please try again shortly." });
  }
}
