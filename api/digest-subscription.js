import { enforceRateLimit } from "../lib/rateLimit.js";
import {
  getDigestConfiguration,
  normalizeDigestEmail,
  sendDigestConfirmation
} from "../lib/digestSubscriptions.js";
import { normalizeDigestRegionIds } from "../shared/digestRegions.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  if (!enforceRateLimit(request, response, {
    name: "digest-subscription",
    limit: 6,
    windowMs: 60 * 60 * 1000,
    message: "Too many signup attempts. Please try again later."
  })) {
    return;
  }

  const body = readBody(request.body);
  // A hidden field catches basic form bots without giving them a useful signal.
  if (String(body.website || "").trim()) {
    response.status(202).json({ ok: true });
    return;
  }

  const email = normalizeDigestEmail(body.email);
  const regionIds = normalizeDigestRegionIds(body.regions);
  if (!email) {
    response.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if (!regionIds.length) {
    response.status(400).json({ error: "Choose at least one regional edition." });
    return;
  }

  const configuration = getDigestConfiguration();
  if (!configuration.ready) {
    console.error(JSON.stringify({
      event: "digest_configuration_missing",
      missing: configuration.missing
    }));
    response.status(503).json({ error: "Weekly email signup is being connected. Please try again soon." });
    return;
  }

  try {
    await sendDigestConfirmation({ email, regionIds }, configuration);
    response.status(202).json({
      ok: true,
      message: "Check your inbox to confirm your regional digest."
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "digest_confirmation_failed",
      message: error?.message
    }));
    response.status(502).json({
      error: "The confirmation email could not be sent. Please try again."
    });
  }
}

function readBody(body) {
  if (body && typeof body === "object") {
    return body;
  }
  try {
    return JSON.parse(String(body || "{}"));
  } catch {
    return {};
  }
}
