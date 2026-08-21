import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { archiveConfigured } from "./roundupArchive.js";

// Channel attribution for newsletter growth. A signup carries a short ?src=
// slug (ctbirds, fb-<group>, reddit, forward, ...) from the page that produced
// it, and the confirmed event is written to Blob so channels can be ranked
// later with scripts/signup-stats.mjs. Only a truncated hash of the address is
// stored; the email itself lives solely in Resend.
const SOURCE_PATTERN = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_SIGNUP_SOURCE = "app";

export function normalizeSignupSource(value) {
  const src = String(value || "").trim().toLowerCase();
  return SOURCE_PATTERN.test(src) ? src : null;
}

export function hashSignupEmail(email) {
  return createHash("sha256").update(String(email || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function recordSignupEvent(
  { type, src, regionIds, email },
  { blobPut = put, now = new Date() } = {}
) {
  const event = {
    type: String(type || "confirmed"),
    src: normalizeSignupSource(src) || DEFAULT_SIGNUP_SOURCE,
    regionIds: Array.isArray(regionIds) ? regionIds : [],
    emailHash: hashSignupEmail(email),
    at: now.toISOString()
  };

  // Attribution must never break a signup: without a Blob token the event is
  // still visible in function logs, just not in the durable store.
  console.log(JSON.stringify({ event: `digest_signup_${event.type}`, src: event.src, regions: event.regionIds }));
  if (!archiveConfigured()) {
    return null;
  }

  // One deterministic blob per address, type, and day: re-clicking the same
  // confirmation link overwrites instead of double counting.
  const day = event.at.slice(0, 10);
  const path = `events/signup/${day}-${event.emailHash}-${event.type}.json`;
  const saved = await blobPut(path, JSON.stringify(event), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return { path, url: saved.url };
}
