import { getSightings } from "../lib/ebirdCore.js";

export default async function handler(request, response) {
  try {
    const payload = await getSightings(request.query);
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.statusCode ? error.message : "Unable to fetch eBird sightings.",
      detail: error.statusCode ? undefined : error.message
    });
  }
}
