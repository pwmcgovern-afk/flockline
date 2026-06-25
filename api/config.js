import { getConfig } from "../lib/ebirdCore.js";

export default function handler(_request, response) {
  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.status(200).json(getConfig());
}
