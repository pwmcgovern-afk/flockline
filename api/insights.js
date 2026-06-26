import { getInsights } from "../lib/ebirdCore.js";

export default async function handler(request, response) {
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
