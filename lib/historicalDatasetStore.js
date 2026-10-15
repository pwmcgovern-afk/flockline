import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const index = JSON.parse(fs.readFileSync(new URL("../data/historical-index.json", import.meta.url), "utf8"));
const root = new URL("../data/historical-counties/", import.meta.url);

// The index is small; county files are read only when needed. Limit retained
// decoded bytes as well as individual files so national coverage cannot make
// every function instance load the entire country's history at startup.
export function createHistoricalDatasetStore({ entries = index.counties,
  read = (file) => fs.readFileSync(new URL(file, root)), fetcher = fetch,
  maxCacheBytes = 16 * 1024 * 1024, timeoutMs = 2500 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;

  function cached(code) {
    const value = cache.get(code);
    if (value) { cache.delete(code); cache.set(code, value); }
    return value?.data;
  }

  function decode(code, entry, bytes) {
    if (bytes.length !== entry.compressedBytes
        || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error("Historical county file does not match its pinned index.");
    }
    const decoded = gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 });
    const data = JSON.parse(decoded);
    if (data.schemaVersion !== 1 || data.areaCode !== code || !Array.isArray(data.pooled)
        || !Array.isArray(data.annual) || data.pooled.some((d) => d.area?.code !== code)
        || data.annual.some((d) => d.areaCode !== code)) {
      throw new Error("Historical county file has the wrong geographic scope.");
    }
    while (cache.size && cacheBytes + decoded.length > maxCacheBytes) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).bytes;
      cache.delete(oldest);
    }
    if (decoded.length <= maxCacheBytes) {
      cache.set(code, { data, bytes: decoded.length });
      cacheBytes += decoded.length;
    }
    return data;
  }

  function entryFor(code) {
    if (!/^US-[A-Z]{2}-\d{3}$/.test(code) || !Object.hasOwn(entries, code)) return null;
    const entry = entries[code];
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.compressedBytes)
        || entry.compressedBytes <= 0 || entry.compressedBytes > 2 * 1024 * 1024) {
      throw new Error("Invalid historical county index entry.");
    }
    return entry;
  }

  function local(code) {
    const entry = entryFor(code);
    if (!entry || !entry.file) return null;
    const hit = cached(code);
    if (hit) return hit;
    if (entry.file !== `${code}.${entry.sha256.slice(0, 12)}.json.gz`) {
      throw new Error("Invalid historical county filename.");
    }
    return decode(code, entry, read(entry.file));
  }

  async function load(code) {
    const entry = entryFor(code);
    if (!entry) return null;
    const hit = cached(code);
    if (hit) return hit;
    if (entry.file) return local(code);
    if (pending.has(code)) return pending.get(code);
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
        || url.username || url.password || url.search || url.hash) {
      throw new Error("Historical data must use a pinned public Blob URL.");
    }
    const request = (async () => {
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Historical county download timed out.")); }, timeoutMs);
      });
      try {
        return await Promise.race([(async () => {
          const response = await fetcher(url.href, { signal: controller.signal, redirect: "error" });
          if (!response.ok || !response.body) throw new Error("Historical county download unavailable.");
          const reader = response.body.getReader();
          const chunks = [];
          let length = 0;
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              length += result.value.byteLength;
              if (length > entry.compressedBytes) throw new Error("Historical county download exceeds its pinned size.");
              chunks.push(Buffer.from(result.value));
            }
            // A caller deadline must not allow a late response to populate cache.
            controller.signal.throwIfAborted();
            return decode(code, entry, Buffer.concat(chunks));
          } finally { reader.cancel().catch(() => {}); }
        })(), deadline]);
      } finally { clearTimeout(timer); }
    })();
    pending.set(code, request);
    try { return await request; }
    finally { pending.delete(code); }
  }

  return { local, load, stats: () => ({ counties: cache.size, decodedBytes: cacheBytes, pending: pending.size }) };
}

export const historicalDatasetStore = createHistoricalDatasetStore();
