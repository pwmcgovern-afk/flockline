import { BlobNotFoundError, head, list, put } from "@vercel/blob";
import { archiveConfigured } from "./roundupArchive.js";
import { getInsights } from "./ebirdCore.js";
import { addBirdIllustrations } from "./birdIllustrations.js";
import { factualEditorialPayload } from "../shared/findingCopy.js";
import { dailyDate, dailyDigestPath, parseDailyDigestPath, scopeFromId } from "../shared/dailyDigest.js";

const PREFIX = "daily-digests/";
export function dailyBlobPath(scopeId, date, back) {
  if (!dailyDigestPath(scopeId, date, back)) throw new Error("Invalid daily digest address");
  return `${PREFIX}${scopeId}/${date}/${back}d.json`;
}
function unavailable(message, statusCode = 503) {
  return Object.assign(new Error(message), { statusCode });
}
function notFound(error) {
  return error instanceof BlobNotFoundError || error?.status === 404 || error?.statusCode === 404 || error?.name === "BlobNotFoundError";
}
function validSnapshot(snapshot, scopeId, date, back) {
  const scope = scopeFromId(scopeId);
  const sameRegions = (regions) => Array.isArray(regions) && regions.length === scope.regions.length && scope.regions.every((region) => regions.includes(region));
  return snapshot?.version === "daily-v1" && snapshot.source === "ebird" &&
    snapshot.scopeId === scopeId && snapshot.date === date && snapshot.back === back &&
    Number.isFinite(Date.parse(snapshot.generatedAt)) && dailyDate(new Date(snapshot.generatedAt)) === date &&
    Array.isArray(snapshot.findings) && snapshot.findings.length <= 24 &&
    sameRegions(snapshot.regions) && sameRegions(snapshot.coverage?.requestedRegions) &&
    sameRegions(snapshot.coverage?.successfulRegions) &&
    Array.isArray(snapshot.coverage?.failedRegions) && snapshot.coverage.failedRegions.length === 0;
}
export async function getDailyDigest(scopeId, date, back = 1, { blobHead = head, fetcher = fetch } = {}) {
  const path = dailyBlobPath(scopeId, date, back);
  let blob;
  try { blob = await blobHead(path); }
  catch (error) { if (notFound(error)) return null; throw error; }
  if (blob.size > 1_000_000) throw unavailable("The saved daily digest is too large");
  const response = await fetcher(blob.url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw unavailable("The saved daily digest could not be read");
  const body = await response.text();
  if (body.length > 1_000_000) throw unavailable("The saved daily digest is too large");
  const snapshot = JSON.parse(body);
  if (!validSnapshot(snapshot, scopeId, date, back)) throw unavailable("The saved daily digest does not match this address");
  return snapshot;
}

// The first complete source snapshot wins. Never rebuild an old day from a
// rolling feed, or overwrite an edition after someone has shared it.
export async function ensureDailyDigest({ scopeId, date, back = 1 }, {
  now = new Date(), read = getDailyDigest, build = getInsights, blobPut = put,
  illustrate = addBirdIllustrations, configured = archiveConfigured(),
} = {}) {
  if (!configured) throw unavailable("Daily digest storage is unavailable");
  if (!dailyDigestPath(scopeId, date, back) || date > dailyDate(now)) throw unavailable("Invalid daily digest address", 400);
  const existing = await read(scopeId, date, back);
  if (existing) return existing;
  if (date !== dailyDate(now)) throw unavailable("No saved digest exists for this day", 404);
  const scope = scopeFromId(scopeId);
  const payload = await build({ regions: scope.regions.join(","), back, fresh: "1" });
  const snapshot = await illustrate({
    ...factualEditorialPayload(payload), version: "daily-v1", scopeId, scopeLabel: scope.label, date,
    publishedAt: now.toISOString(),
  }, "https://flockline.app", { generateMissing: false });
  if (!validSnapshot(snapshot, scopeId, date, back))
    throw unavailable("A complete current eBird snapshot is not available yet. Please try again.");
  const body = JSON.stringify(snapshot);
  if (Buffer.byteLength(body, "utf8") > 1_000_000)
    throw unavailable("This selection is too large to save. Choose a shorter report window.", 413);
  try {
    await blobPut(dailyBlobPath(scopeId, date, back), body, {
      access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
    });
    return snapshot;
  } catch (error) {
    // A competing request may have published the same address first.
    if (error?.status !== 409 && error?.statusCode !== 409 &&
        !/already exists/i.test(error?.message || "")) throw error;
    const winner = await read(scopeId, date, back);
    if (!winner) throw unavailable("The daily digest is still being saved. Please try again.");
    return winner;
  }
}

export async function listDailyDigests({ blobList = list } = {}) {
  if (!archiveConfigured()) return [];
  const issues = [];
  let cursor;
  for (let pageCount = 0; pageCount < 50; pageCount++) {
    const page = await blobList({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs || []) {
      const match = blob.pathname.match(/^daily-digests\/([a-z-]+)\/(\d{4}-\d{2}-\d{2})\/(1|3|7|14|30)d\.json$/);
      if (!match) continue;
      const [, scopeId, date, window] = match;
      const back = Number(window);
      const path = dailyDigestPath(scopeId, date, back);
      if (path && parseDailyDigestPath(path).valid) issues.push({ scopeId, date, back, path });
    }
    if (!page.hasMore || !page.cursor) return issues.sort((a, b) => b.date.localeCompare(a.date) || a.scopeId.localeCompare(b.scopeId) || a.back - b.back);
    cursor = page.cursor;
  }
  throw unavailable("Daily digest index is temporarily too large to load");
}
