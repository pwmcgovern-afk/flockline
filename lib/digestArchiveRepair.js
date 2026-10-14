import { put } from "@vercel/blob";
import { getDigestRegion } from "../shared/digestRegions.js";
import { createDigestStore, deliveryPath } from "./digestDeliveryStore.js";
import { listArchivedRoundups, normalizeArchiveDate, saveRoundup } from "./roundupArchive.js";
import { missingBirdIllustrations } from "./birdIllustrations.js";

// This path publishes only an already saved edition. It never calls a mail
// provider, refreshes current observations, or generates artwork.
export async function repairMissingDigestArchive(
  { date, regionId, apply = false },
  {
    store = createDigestStore(), listArchive = listArchivedRoundups,
    archive = saveMissingRoundup, verifyArtwork = checkArtwork,
    now = Date.now,
  } = {},
) {
  if (!normalizeArchiveDate(date) || !getDigestRegion(regionId)) {
    throw new Error("Choose a valid edition date and region.");
  }
  if (date >= new Date(now()).toISOString().slice(0, 10)) {
    throw new Error("Archive recovery is only for completed past edition dates.");
  }
  const sourcePath = deliveryPath(date, regionId);
  const record = await store.read(sourcePath);
  const receipt = record?.value;
  if (!receipt || receipt.date !== date || receipt.region !== regionId) {
    throw new Error("No matching original delivery receipt exists.");
  }
  if (Number(receipt.leaseUntil) > now()) throw new Error("The edition still has an active worker lease.");
  const roundup = receipt.roundup;
  if (roundup?.source !== "ebird" || roundup.scopeId !== regionId
    || String(roundup.generatedAt).slice(0, 10) !== date
    || !Array.isArray(roundup.findings) || !roundup.findings.length) {
    throw new Error("The saved source snapshot does not match this edition.");
  }
  for (const finding of roundup.findings) {
    const observedDate = normalizeArchiveDate(String(finding.obsDt || "").slice(0, 10));
    if (!/^S\d{6,15}$/.test(finding.subId || "") || !/^[a-z0-9-]{2,32}$/.test(finding.speciesCode || "")
      || !observedDate || observedDate > date) {
      throw new Error("Every finding must retain a valid original checklist, species, and observation date.");
    }
  }
  if (missingBirdIllustrations(roundup).length) throw new Error("The saved edition is missing artwork.");
  const existing = (await listArchive({ scopeId: regionId })).find(issue => issue.date === date);
  if (existing) throw new Error("That archive already exists; this command never replaces published editions.");
  const artwork = await Promise.all(roundup.findings.map(async (finding) => ({
    speciesCode: finding.speciesCode, available: await verifyArtwork(finding),
  })));
  if (artwork.some(item => !item.available)) throw new Error("Saved artwork could not be verified; no archive was published.");
  const result = {
    mode: apply ? "apply" : "dry_run", date, region: regionId, sourcePath,
    generatedAt: roundup.generatedAt, receiptStatus: receipt.status,
    sourceFacts: roundup.findings.map(({ speciesCode, subId, obsDt, howMany, locName }) => ({ speciesCode, subId, obsDt, howMany, locName })),
    findings: roundup.findings.length, illustrations: artwork.length,
    archiveAbsent: true, sourceValidated: true, artworkVerified: true,
    saved: false, emailSent: false, deliveryReceiptChanged: false,
  };
  if (apply) {
    // Recheck the source version immediately before publication. A conditional
    // create also prevents replacing an archive that appeared during inspection.
    const current = await store.read(sourcePath);
    if (current?.etag !== record.etag) throw new Error("The source receipt changed during inspection. Run the command again.");
    const saved = await archive(roundup);
    result.saved = true;
    result.url = saved.url;
  }
  return result;
}

function saveMissingRoundup(roundup) {
  return saveRoundup(roundup, {
    blobPut: (path, body, options) => put(path, body, { ...options, allowOverwrite: false }),
  });
}

async function checkArtwork(finding) {
  try {
    const url = new URL(finding.image.url);
    const hosted = url.protocol === "https:" && (
      (url.hostname.endsWith(".public.blob.vercel-storage.com") && url.pathname === `/illustrations/${finding.speciesCode}-v1.jpg`)
      || (url.hostname === "flockline.app" && url.pathname === `/digest-illustrations/${finding.speciesCode}-v1.jpg`)
    );
    if (!hosted) return false;
    const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return response.ok && (response.headers.get("content-type") || "").startsWith("image/");
  } catch {
    return false;
  }
}
