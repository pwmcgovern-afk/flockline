import { list, put } from "@vercel/blob";
import { sightingPath } from "../shared/sightingPath.js";

// The notable feed rolls away after 30 days. Save source-backed context when
// publishing a finding so email and archive links continue to resolve later.
const recent = new Map();
export async function saveSightingFindings(payload, { blobPut = put } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN || payload?.source === "demo") return;
  const results = await Promise.allSettled(
    (payload?.findings || []).map(async (finding) => {
      const path = sightingPath(finding);
      if (!path) return;
      const record = {
        ...finding,
        scopeId: payload.scopeId || null,
        publishedAt: payload.generatedAt,
      };
      const serialized = JSON.stringify(record);
      if (recent.get(path) === serialized) return;
      await blobPut(`${path.slice(1)}.json`, serialized, {
        abortSignal: AbortSignal.timeout(4000),
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      if (recent.size >= 500) recent.delete(recent.keys().next().value);
      recent.set(path, serialized);
    }),
  );
  for (const result of results) {
    if (result.status === "rejected")
      console.error("Sighting context save failed", result.reason?.message);
  }
}

export async function readSightingRecord(
  prefix,
  { blobList = list, fetcher = fetch } = {},
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { blobs } = await blobList({
    prefix,
    limit: 1,
    abortSignal: AbortSignal.timeout(4000),
  });
  const blob = blobs.find((item) => item.pathname === prefix);
  if (!blob) return null;
  const response = await fetcher(blob.url, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Saved sighting unavailable");
  return response.json();
}
