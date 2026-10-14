import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { enforceRateLimit } from "./rateLimit.js";

const WINDOW_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const CHAT_LIMITS = { client: 8, window: 40, day: 200 };

// This is deliberately a low-volume admission gate. One conditional write
// reserves all three limits together, across instances and deployments.
export async function enforceChatAdmission(request, response, { signal } = {}) {
  if (process.env.VERCEL !== "1" || !process.env.ANTHROPIC_API_KEY) {
    return enforceRateLimit(request, response, {
      name: "chat", limit: CHAT_LIMITS.client, windowMs: WINDOW_MS,
      message: "You have reached the Ask limit for now. Please try again in a few minutes.",
    });
  }
  const secret = process.env.DIGEST_SIGNING_SECRET;
  if (!secret || !process.env.ASK_READ_WRITE_TOKEN) throw unavailable();
  const controller = new AbortController();
  // The Blob SDK recognizes AbortError, but retries TimeoutError. Cancel with
  // the default reason and bound our own wait even during SDK retry backoff.
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 3_000);
  timer.unref?.();
  const workSignal = controller.signal;
  let rejectAborted;
  const aborted = new Promise((_resolve, reject) => {
    rejectAborted = () => reject(unavailable());
    workSignal.addEventListener("abort", rejectAborted, { once: true });
    if (workSignal.aborted) rejectAborted();
  });
  const store = createChatAdmissionStore(workSignal);
  const scope = process.env.VERCEL_ENV === "production" ? "production" : "preview";
  let result;
  try {
    // Promise.race observes a late reservation rejection too. A timed-out
    // write may consume a slot, but it can never authorize paid model work.
    result = await Promise.race([
      reserveChatRequest({
        store, path: `ask-admission/flockline/v1/${scope}.json`, secret,
        client: chatClientAddress(request), signal: workSignal,
      }),
      aborted,
    ]);
    workSignal.throwIfAborted();
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    workSignal.removeEventListener("abort", rejectAborted);
  }
  response.setHeader("RateLimit-Limit", String(result.limit));
  response.setHeader("RateLimit-Remaining", String(result.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (result.allowed) return true;
  response.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
  response.status(429).json({ error: result.scope === "client"
    ? "You have reached the Ask limit for now. Please try again in a few minutes."
    : "Ask has reached its shared usage limit. Please try again later. The map and Insights are still available." });
  return false;
}

export async function reserveChatRequest({ store, path, secret, client, signal, now = Date.now, limits = CHAT_LIMITS }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    signal?.throwIfAborted();
    const record = await store.read(path);
    signal?.throwIfAborted();
    const time = now();
    const day = Math.floor(time / DAY_MS);
    const window = Math.floor(time / WINDOW_MS);
    const clientKey = createHmac("sha256", secret).update(`${path}:ask-client-v1:${window}:${client}`).digest("hex");
    const previous = record?.value;
    if (record && (!validState(previous) || previous.day > day || previous.window > window)) throw unavailable();
    const state = {
      version: 1, day, window,
      dailyCount: previous?.day === day ? previous.dailyCount : 0,
      windowCount: previous?.window === window ? previous.windowCount : 0,
      clients: previous?.window === window ? { ...previous.clients } : {},
    };
    const counters = [
      { scope: "day", count: state.dailyCount, limit: limits.day, resetAt: (day + 1) * DAY_MS },
      { scope: "window", count: state.windowCount, limit: limits.window, resetAt: (window + 1) * WINDOW_MS },
      { scope: "client", count: state.clients[clientKey] || 0, limit: limits.client, resetAt: (window + 1) * WINDOW_MS },
    ];
    const exhausted = counters.find((counter) => counter.count >= counter.limit);
    if (exhausted) return { ...exhausted, allowed: false, remaining: 0 };
    state.dailyCount += 1;
    state.windowCount += 1;
    state.clients[clientKey] = (state.clients[clientKey] || 0) + 1;
    try {
      signal?.throwIfAborted();
      await store.write(path, state, record?.etag);
      signal?.throwIfAborted();
      return { allowed: true, scope: "client", limit: limits.client,
        remaining: limits.client - state.clients[clientKey], resetAt: (window + 1) * WINDOW_MS };
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }
  throw unavailable();
}

export function createChatAdmissionStore(signal, { blobGet = get, blobPut = put } = {}) {
  const options = { access: "private", token: process.env.ASK_READ_WRITE_TOKEN, abortSignal: signal };
  return {
    async read(path) {
      // Only private Blob supports origin-consistent reads. Public useCache:false
      // is ignored by the SDK and can repeatedly return an obsolete ETag.
      const result = await blobGet(path, { ...options, useCache: false,
        headers: { "accept-encoding": "identity" } });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.blob.etag || result.blob.etag.startsWith("W/")) throw unavailable();
      return { value: await new Response(result.stream).json(), etag: result.blob.etag };
    },
    async write(path, value, etag) {
      return blobPut(path, JSON.stringify(value), {
        ...options, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60,
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
      });
    },
  };
}

export function chatClientAddress(request) {
  // Vercel supplies/overwrites these headers. A local HTTP client must not be
  // able to invent its identity with an arbitrary forwarded header.
  const value = process.env.VERCEL === "1"
    ? request.headers?.["x-vercel-forwarded-for"] || request.headers?.["x-forwarded-for"]
    : request.socket?.remoteAddress;
  const address = String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) return new URL(`http://[${address}]`).hostname.toLowerCase();
  return "unknown";
}

function validState(state) {
  return state && typeof state === "object" && state.version === 1 && [state.day, state.window, state.dailyCount, state.windowCount].every((value) => Number.isSafeInteger(value) && value >= 0)
    && state.day === Math.floor(state.window * WINDOW_MS / DAY_MS) && state.dailyCount >= state.windowCount
    && state.clients && typeof state.clients === "object" && !Array.isArray(state.clients)
    && Object.values(state.clients).reduce((sum, count) => sum + count, 0) === state.windowCount
    && Object.entries(state.clients).every(([key, count]) => /^[a-f0-9]{64}$/.test(key) && Number.isSafeInteger(count) && count > 0);
}

function isConflict(error) {
  return error instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(error?.message || "");
}

function unavailable() {
  return Object.assign(new Error("Ask is temporarily unavailable. Please try again shortly. The map and Insights are still available."), { statusCode: 503, code: "admission_unavailable" });
}
