import { getSpeciesSuggestions } from "../lib/ebirdCore.js";

export default async function handler(request, response) {
  try {
    const payload = await getSpeciesSuggestions(request.query.q);
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({ error: "Unable to search species.", detail: error.message });
  }
}
