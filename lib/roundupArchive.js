import { list, put } from "@vercel/blob";
import { getDigestRegion } from "../shared/digestRegions.js";

// Weekly issues are persisted to Vercel Blob at send time because they cannot
// be rebuilt later: eBird's notable feed only serves a rolling window, so a
// roundup that is not saved the day it is generated is gone. There is no
// separate manifest to maintain; the archive index is derived from the blob
// listing itself, which keeps writes race-free.
const ROUNDUP_PREFIX = "roundups/";

export function archiveConfigured(environment = process.env) {
  return Boolean(String(environment.BLOB_READ_WRITE_TOKEN || "").trim());
}

export function normalizeArchiveDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function roundupBlobPath(scopeId, date) {
  return `${ROUNDUP_PREFIX}${scopeId}/${date}.json`;
}

// roundups/northeast/2026-08-24.json -> { scopeId, date }
export function parseRoundupBlobPath(pathname) {
  const match = String(pathname || "").match(
    /^roundups\/([a-z-]+)\/(\d{4}-\d{2}-\d{2})\.json$/
  );
  if (!match || !getDigestRegion(match[1])) {
    return null;
  }
  return { scopeId: match[1], date: match[2] };
}

export async function saveRoundup(roundup, { blobPut = put } = {}) {
  if (!archiveConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  }
  const scopeId = String(roundup?.scopeId || "").trim();
  const date = normalizeArchiveDate(String(roundup?.generatedAt || "").slice(0, 10));
  if (!getDigestRegion(scopeId) || !date) {
    throw new Error("The roundup is missing a valid scope or date.");
  }

  // Deterministic path + overwrite makes a same-day re-run idempotent.
  const saved = await blobPut(roundupBlobPath(scopeId, date), JSON.stringify(roundup), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return { scopeId, date, url: saved.url };
}

export async function listArchivedRoundups({ scopeId, blobList = list } = {}) {
  if (!archiveConfigured()) {
    return [];
  }
  const prefix = scopeId ? `${ROUNDUP_PREFIX}${scopeId}/` : ROUNDUP_PREFIX;
  const issues = [];
  let cursor;
  do {
    const page = await blobList({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs || []) {
      const parsed = parseRoundupBlobPath(blob.pathname);
      if (parsed) {
        issues.push({ ...parsed, url: blob.url });
      }
    }
    cursor = page.cursor && page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return issues.sort((a, b) => b.date.localeCompare(a.date) || a.scopeId.localeCompare(b.scopeId));
}

export async function getArchivedRoundup(scopeId, date, { blobList = list, fetcher = fetch } = {}) {
  const issues = await listArchivedRoundups({ scopeId, blobList });
  const issue = date
    ? issues.find((item) => item.date === date)
    : issues[0];
  if (!issue) {
    return null;
  }
  const response = await fetcher(issue.url);
  if (!response.ok) {
    throw new Error(`The archived roundup could not be read (${response.status}).`);
  }
  return response.json();
}
