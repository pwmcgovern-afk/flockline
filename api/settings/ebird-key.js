import { activateApiKey, sanitizeApiKey, validateEbirdKey } from "../../lib/ebirdCore.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const apiKey = sanitizeApiKey(request.body?.apiKey);
  if (!apiKey) {
    response.status(400).json({ error: "Enter a valid eBird API key." });
    return;
  }

  try {
    await validateEbirdKey(apiKey);
    activateApiKey(apiKey);
    response.status(200).json({ hasApiKey: true });
  } catch (error) {
    response.status(400).json({
      error: "That eBird API key did not validate.",
      detail: error.message
    });
  }
}
