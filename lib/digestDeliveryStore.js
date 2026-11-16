import { get, head, put, BlobPreconditionFailedError, BlobNotFoundError } from "@vercel/blob";
import { getDigestRegion } from "../shared/digestRegions.js";
import { normalizeArchiveDate } from "./roundupArchive.js";

export function deliveryPath(date, region, kind = "delivery") {
  if (!normalizeArchiveDate(date) || !getDigestRegion(region) || !["delivery", "check"].includes(kind)) {
    throw new Error("Invalid digest record key.");
  }
  return `digest-${kind}/${date}/${region}.json`;
}

// Keep delivery evidence outside short-lived function logs. Records contain no
// subscribers, credentials, or provider error bodies because this store is public.
//
// Public Blob reads go through the CDN. The SDK's `useCache: false` only
// bypasses it for private stores, and query strings are not part of the cache
// key, so a read can return an older version of a receipt. A stale version
// carries a stale ETag, and the conditional write that takes the lease then
// fails, which looked like "busy" on every November 16 South attempt.
// `head()` asks the Blob API directly (no CDN), so its ETag is authoritative:
// a body whose ETag differs from it is stale and is re-read, never written.
export class StaleDigestReadError extends Error {
  constructor(path) {
    super(`Digest storage served an outdated copy of ${path}.`);
    this.name = "StaleDigestReadError";
  }
}

export function createDigestStore({ blobGet = get, blobHead = head, blobPut = put, wait = sleep, staleRetries = 4 } = {}) {
  const readBody = async (path) => {
    const result = await blobGet(path, {
      access: "public", useCache: false, abortSignal: AbortSignal.timeout(10_000),
      // Compressed responses have weak W/ ETags, which Blob rejects for
      // conditional writes. Read the identity representation so a later
      // worker can acquire the lease using the same strong storage ETag.
      headers: { "accept-encoding": "identity" }
    });
    if (!result) return null;
    if (!result.blob.etag || result.blob.etag.startsWith("W/")) {
      throw new Error("Digest storage did not return a strong version identifier.");
    }
    return { result, etag: result.blob.etag };
  };
  const currentEtag = async (path) => {
    try {
      return (await blobHead(path, { abortSignal: AbortSignal.timeout(10_000) })).etag;
    } catch (error) {
      if (error instanceof BlobNotFoundError || error?.name === "BlobNotFoundError") return null;
      throw error;
    }
  };
  return {
    async read(path) {
      for (let attempt = 0; ; attempt += 1) {
        const [body, authoritative] = await Promise.all([readBody(path), currentEtag(path)]);
        if (!body && !authoritative) return null;
        if (body && body.etag === authoritative) {
          return { value: await new Response(body.result.stream).json(), etag: body.etag };
        }
        await body?.result.stream?.cancel?.().catch(() => {});
        if (attempt >= staleRetries) throw new StaleDigestReadError(path);
        await wait(1_000 * 2 ** attempt);
      }
    },
    async write(path, value, etag) {
      const result = await blobPut(path, JSON.stringify(value), {
        access: "public", contentType: "application/json", addRandomSuffix: false,
        cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(10_000),
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false })
      });
      return { value, etag: result.etag };
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isWriteConflict = (error) => error instanceof BlobPreconditionFailedError
  || /already exists|precondition/i.test(String(error?.message));

export async function withDigestLease({ date, region, store, now = Date.now, operation = "delivery" }, task) {
  const path = deliveryPath(date, region);
  let record;
  // Two tries: a write conflict right after a read usually means another
  // worker (or a just-finished one) changed the receipt, so look again once.
  for (let attempt = 0; ; attempt += 1) {
    try {
      record = await store.read(path);
    } catch (error) {
      if (error instanceof StaleDigestReadError) return { status: "busy", reason: "stale_read", region, date };
      throw error;
    }
    if (record?.value.status === "sent") return { ...record.value, alreadyComplete: true };
    // Preparation must not regress a completed empty-audience edition or touch
    // an existing provider campaign. Delivery can still reconcile either state.
    if (operation === "prepare" && (record?.value.broadcastId
      || (record?.value.status === "no_recipients" && record.value.archived === true))) {
      return { ...record.value, preparationSkipped: true };
    }
    if (Number(record?.value.leaseUntil) > now()) {
      return { status: "busy", reason: "lease_held", leaseOperation: record.value.operation, region, date };
    }
    try {
      record = await store.write(path, {
        ...record?.value, date, region, leaseUntil: now() + 10 * 60_000,
        updatedAt: new Date(now()).toISOString(), attempts: (record?.value.attempts || 0) + 1,
        operation, phase: "load_roundup", attemptStartedAt: new Date(now()).toISOString()
      }, record?.etag);
      break;
    } catch (error) {
      // Conditional creation/update arbitrates overlapping cron invocations.
      if (!isWriteConflict(error)) throw error;
      if (attempt >= 1) return { status: "busy", reason: "write_conflict", region, date };
    }
  }

  const save = async (changes) => {
    record = await store.write(path, {
      ...record.value, ...changes, updatedAt: new Date(now()).toISOString()
    }, record.etag);
    return record.value;
  };
  try {
    await task(record.value, save);
    return await save({ leaseUntil: 0 });
  } catch (error) {
    // Retain the roundup and broadcast ID across retries, even after an
    // uncertain network result. Never regenerate a replacement broadcast.
    await save({ status: "failed", leaseUntil: 0, failedAt: new Date(now()).toISOString(),
      failure: digestFailureEvidence(error, { operation, phase: record.value.phase, now })
    }).catch(() => {});
    throw error;
  }
}

// Receipts are public. Persist where an attempt failed, never provider messages,
// request bodies, addresses, or credentials. A later retry retains this evidence.
export function digestFailureEvidence(error, { operation, phase, now = Date.now }) {
  const status = Number(error?.statusCode ?? error?.status);
  const code = Number.isInteger(status) && status >= 400 && status <= 599
    ? `http_${status}`
    : ["AbortError", "TimeoutError"].includes(error?.name) ? "timeout" : "operation_failed";
  return { operation, phase, code, at: new Date(now()).toISOString() };
}
