import { prepareDigestIllustrations } from "../../lib/digestPreparation.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";
import { archiveConfigured } from "../../lib/roundupArchive.js";

export const config = { maxDuration: 300 };

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  const secret = String(process.env.CRON_SECRET || "");
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0] : request.headers.authorization;
  if (!secret || authorization !== `Bearer ${secret}`) {
    response.status(401).json({ error: "Unauthorized." });
    return;
  }
  const region = DIGEST_REGIONS.find((item) => item.id === request.query?.region);
  if (!region) {
    response.status(400).json({ error: "Choose one digest region." });
    return;
  }
  if (!archiveConfigured()) {
    response.status(503).json({ error: "Illustration storage is not configured." });
    return;
  }
  try {
    const result = await prepareDigestIllustrations({
      region, date: new Date().toISOString().slice(0, 10),
      appUrl: String(process.env.PUBLIC_APP_URL || "https://flockline.app").replace(/\/$/, ""),
      // Vercel supplies fresh function credentials on the request, while the
      // environment token is for builds/local use and can already be expired.
      // Keep this request-scoped so concurrent invocations cannot share tokens.
      environment: {
        ...process.env,
        VERCEL_OIDC_TOKEN: request.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN
      }
    });
    const { status, findings, illustrations, unresolved = [] } = result;
    const ok = ["prepared", "sent", "submitted", "draft", "no_recipients"].includes(status);
    console.info(JSON.stringify({ event: "illustration_prewarm_completed", region: region.id, status, unresolved }));
    response.status(ok || status === "busy" ? 200 : 503).json({
      ok, region: region.id, status, findings, illustrations, unresolved
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "illustration_prewarm_failed", region: region.id, message: error.message }));
    response.status(500).json({ ok: false, error: "Illustration preparation failed." });
  }
}
