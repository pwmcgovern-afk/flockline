import { get, list, put } from "@vercel/blob";

export const OPERATIONAL_ROUTES = Object.freeze(["chat", "insights", "sighting", "roundup"]);
export const OPERATIONAL_CATEGORIES = Object.freeze(["admission", "source", "timeout", "unknown"]);
export const OPERATIONAL_ENVIRONMENTS = Object.freeze(["production", "preview", "development"]);
const DAY_MS = 86_400_000;
const DAY_SLOTS = 14;
const PREFIX = "operational-samples/flockline/v1";

function currentEnvironment() {
  return OPERATIONAL_ENVIRONMENTS.includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : "development";
}

function sample(event, time) {
  if (!OPERATIONAL_ROUTES.includes(event?.route) || !OPERATIONAL_CATEGORIES.includes(event?.category)
    || !Number.isSafeInteger(time) || time < 0 || !Number.isFinite(new Date(time).getTime())) return null;
  // This explicit allowlist also applies when reading stored JSON. Never spread
  // an error or a request into a public record, even if callers supply one.
  return {
    version: 1,
    route: event.route,
    category: event.category,
    occurredAt: new Date(time).toISOString(),
    ...(Number.isInteger(event.httpStatus) && event.httpStatus >= 400 && event.httpStatus <= 599
      ? { httpStatus: event.httpStatus } : {}),
  };
}

function samplePath(event, environment) {
  const slot = Math.floor(Date.parse(event.occurredAt) / DAY_MS) % DAY_SLOTS;
  return `${PREFIX}/${environment}/${event.route}/${event.category}/${slot}.json`;
}

// These are diagnostic samples, not an ordered event ledger or exact counts.
// The ring bounds storage to 224 files per environment. Concurrent writes may
// retain either sample, and public CDN reads can lag writes. An inactive slot
// remains stored until reused; readers omit samples older than 14 UTC days.
export function createOperationalRecorder({ blobPut = put, now = Date.now, environment = currentEnvironment,
  token = () => process.env.BLOB_READ_WRITE_TOKEN, cooldownMs = 60_000, timeoutMs = 2_000 } = {}) {
  const lastAttempt = new Map();
  return async function record(event) {
    const time = now();
    const value = sample(event, time);
    const scope = typeof environment === "function" ? environment() : environment;
    if (!value || !OPERATIONAL_ENVIRONMENTS.includes(scope)) return { recorded: false, reason: "invalid_event" };
    const publicToken = typeof token === "function" ? token() : token;
    // Admission uses a separate private store. Pin these public samples to the
    // existing public-store token instead of following an OIDC default store.
    if (typeof publicToken !== "string" || !publicToken.trim()) return { recorded: false, reason: "storage_unavailable" };
    const key = `${scope}:${value.route}:${value.category}`;
    const previous = lastAttempt.get(key);
    if (previous !== undefined && time >= previous && time - previous < cooldownMs) {
      return { recorded: false, reason: "suppressed" };
    }
    // Suppress before starting I/O, including failed attempts. This bounds an
    // error storm within an instance without adding another shared counter.
    lastAttempt.set(key, time);
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ recorded: false, reason: "write_timeout" });
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      const write = Promise.resolve().then(() => blobPut(samplePath(value, scope), JSON.stringify(value), {
        access: "public", contentType: "application/json", cacheControlMaxAge: 60,
        token: publicToken, addRandomSuffix: false, allowOverwrite: true, abortSignal: controller.signal,
      })).then(() => ({ recorded: true }), () => ({ recorded: false, reason: "write_failed" }));
      return await Promise.race([write, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export const recordOperationalEvent = createOperationalRecorder();

export async function readOperationalSnapshots({ environment = "production", days = 2, route,
  now = Date.now, blobList = list, blobGet = get, token = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  if (!OPERATIONAL_ENVIRONMENTS.includes(environment) || !Number.isInteger(days) || days < 1 || days > DAY_SLOTS
    || (route !== undefined && !OPERATIONAL_ROUTES.includes(route))) throw new Error("Invalid operational snapshot filters.");
  if (typeof token !== "string" || !token.trim()) throw new Error("Operational sample storage is not configured.");
  const time = now();
  const today = Math.floor(time / DAY_MS);
  const earliest = (today - days + 1) * DAY_MS;
  const prefix = `${PREFIX}/${environment}/`;
  const slots = new Set(Array.from({ length: days }, (_, offset) => String((today - offset) % DAY_SLOTS)));
  const signal = AbortSignal.timeout(15_000);
  const paths = [];
  let cursor;
  do {
    const page = await blobList({ prefix, limit: 1000, ...(cursor ? { cursor } : {}), token, abortSignal: signal });
    for (const blob of page.blobs) {
      const match = blob.pathname.slice(prefix.length).match(/^([^/]+)\/([^/]+)\/(\d+)\.json$/);
      if (blob.pathname.startsWith(prefix) && match && OPERATIONAL_ROUTES.includes(match[1])
        && (!route || match[1] === route) && OPERATIONAL_CATEGORIES.includes(match[2]) && slots.has(match[3])) paths.push(blob.pathname);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const events = [];
  let failedReads = 0;
  let omittedRecords = 0;
  for (let index = 0; index < paths.length; index += 6) {
    await Promise.all(paths.slice(index, index + 6).map(async (path) => {
      try {
        signal.throwIfAborted();
        const result = await blobGet(path, { access: "public", token, abortSignal: signal });
        if (!result || result.statusCode !== 200) { omittedRecords += 1; return; }
        const raw = await new Response(result.stream).json();
        const value = raw?.version === 1 && typeof raw.occurredAt === "string" ? sample(raw, Date.parse(raw.occurredAt)) : null;
        const occurred = value ? Date.parse(value.occurredAt) : NaN;
        if (!value || occurred < earliest || occurred > time || samplePath(value, environment) !== path) {
          omittedRecords += 1;
          return;
        }
        events.push(value);
      } catch { failedReads += 1; }
    }));
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { environment, days, ...(route ? { route } : {}), events, failedReads, omittedRecords,
    completeHistory: false, visibility: "Public Blob samples can lag writes by up to 60 seconds. No samples does not establish service health." };
}
