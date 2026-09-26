import { getSightingDetails } from "../lib/sightingDetails.js";
export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }
  try {
    const sighting = await getSightingDetails(request.query);
    response.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=900",
    );
    return response.status(200).json(sighting);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    return response
      .status(error.statusCode || 502)
      .json({ error: "The sighting could not be loaded." });
  }
}
