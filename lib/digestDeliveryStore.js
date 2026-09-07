import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
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
export function createDigestStore({ blobGet = get, blobPut = put } = {}) {
  return {
    async read(path) {
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
      return { value: await new Response(result.stream).json(), etag: result.blob.etag };
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

export async function withDigestLease({ date, region, store, now = Date.now }, task) {
  const path = deliveryPath(date, region);
  let record = await store.read(path);
  if (record?.value.status === "sent") return { ...record.value, alreadyComplete: true };
  if (Number(record?.value.leaseUntil) > now()) return { status: "busy", region, date };
  try {
    record = await store.write(path, {
      ...record?.value, date, region, leaseUntil: now() + 10 * 60_000,
      updatedAt: new Date(now()).toISOString(), attempts: (record?.value.attempts || 0) + 1
    }, record?.etag);
  } catch (error) {
    // Conditional creation/update arbitrates overlapping cron invocations.
    if (error instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(error.message)) {
      return { status: "busy", region, date };
    }
    throw error;
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
    await save({ status: "failed", leaseUntil: 0, failedAt: new Date(now()).toISOString() }).catch(() => {});
    throw error;
  }
}
