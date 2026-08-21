import { getDigestRegion } from "../shared/digestRegions.js";
import {
  archiveConfigured,
  getArchivedRoundup,
  listArchivedRoundups,
  normalizeArchiveDate
} from "../lib/roundupArchive.js";

// Read-only access to the persisted weekly issues. ?list=1 returns the index
// (derived from the blob listing), ?scope=northeast returns that region's
// latest issue, and ?scope=northeast&date=2026-08-24 returns one exact issue.
export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!archiveConfigured()) {
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({ error: "The roundup archive is not configured yet." });
    return;
  }

  // Issues never change after publication, so let the CDN carry the load.
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");

  try {
    if (String(request.query?.list || "") === "1") {
      const issues = await listArchivedRoundups();
      response.status(200).json({
        issues: issues.map(({ scopeId, date }) => ({ scopeId, date }))
      });
      return;
    }

    const scopeId = String(request.query?.scope || "").trim().toLowerCase();
    if (!getDigestRegion(scopeId)) {
      response.setHeader("Cache-Control", "no-store");
      response.status(400).json({ error: "Unknown roundup region." });
      return;
    }

    const rawDate = request.query?.date;
    const date = rawDate ? normalizeArchiveDate(rawDate) : null;
    if (rawDate && !date) {
      response.setHeader("Cache-Control", "no-store");
      response.status(400).json({ error: "Dates look like 2026-08-24." });
      return;
    }

    const roundup = await getArchivedRoundup(scopeId, date);
    if (!roundup) {
      response.status(404).json({ error: "No archived issue exists there yet." });
      return;
    }
    response.status(200).json(roundup);
  } catch (error) {
    console.error(JSON.stringify({
      event: "roundup_archive_read_failed",
      message: error?.message
    }));
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({ error: "The roundup archive could not be read." });
  }
}
