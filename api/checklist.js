import { getChecklistDetails } from "../lib/ebirdCore.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const payload = await getChecklistDetails(request.query);
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.statusCode ? error.message : "Unable to fetch eBird checklist details."
    });
  }
}
