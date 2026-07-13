import { getSightings } from "../lib/ebirdCore.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const payload = await getSightings(request.query);
    const fresh = ["1", "true", "yes", "on"].includes(String(request.query.fresh || "").toLowerCase());
    response.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=300, stale-while-revalidate=300");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.statusCode ? error.message : "Unable to fetch eBird sightings.",
      detail: error.statusCode ? undefined : error.message
    });
  }
}
