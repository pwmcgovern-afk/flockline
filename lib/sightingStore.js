import { list, put } from "@vercel/blob";
import { matchingRegionPreset } from "../shared/usGeography.js";
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
        scopeId: payload.scopeId || matchingRegionPreset(payload.regions || [])?.id || null,
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
  { blobList = list, fetcher = fetch, signal } = {},
) {
  signal?.throwIfAborted();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { blobs } = await withReadDeadline((workSignal) => blobList({
    prefix, limit: 1, abortSignal: workSignal,
  }), signal, 4000);
  const blob = blobs.find((item) => item.pathname === prefix);
  if (!blob) return null;
  signal?.throwIfAborted();
  return withReadDeadline(async (workSignal) => {
    const response = await fetcher(blob.url, { signal: workSignal });
    workSignal.throwIfAborted();
    if (!response.ok) throw new Error("Saved sighting unavailable");
    return response.json();
  }, signal, 5000);
}

async function withReadDeadline(read, signal, timeoutMs) {
  const controller = new AbortController();
  // Blob retries TimeoutError and may already be sleeping between requests.
  // Use AbortError and bound the caller's wait independently of SDK behavior.
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  timer.unref?.();
  let rejectAborted;
  const aborted = new Promise((_resolve, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
    if (controller.signal.aborted) rejectAborted();
  });
  try {
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return read(controller.signal);
    });
    // The race also observes late SDK failures, preventing unhandled rejection.
    const result = await Promise.race([work, aborted]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}
