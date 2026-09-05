import { createDigestStore, deliveryPath } from "../lib/digestDeliveryStore.js";
import { normalizeArchiveDate } from "../lib/roundupArchive.js";
import { DIGEST_REGIONS } from "../shared/digestRegions.js";

const args = process.argv.slice(2);
const date = args[args.indexOf("--date") + 1];
const kind = args.includes("--check") ? "check" : "delivery";
if (!args.includes("--date") || !normalizeArchiveDate(date)) {
  throw new Error("Usage: node scripts/digest-status.mjs --date YYYY-MM-DD [--check]");
}
if (!process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN.includes("SENSITIVE")) {
  throw new Error("Load the Flockline BLOB_READ_WRITE_TOKEN to read delivery receipts.");
}
const store = createDigestStore();
const results = [];
for (const region of DIGEST_REGIONS) {
  const record = await store.read(deliveryPath(date, region.id, kind));
  const value = record?.value;
  results.push({
    region: region.id, status: value?.status || "missing",
    updatedAt: value?.updatedAt || value?.checkedAt,
    broadcastId: value?.broadcastId, providerStatus: value?.providerStatus,
    archived: value?.archived, hasRecipients: value?.hasRecipients,
    findings: value?.findings, illustrations: value?.illustrations
  });
}
const healthy = results.every((result) => kind === "check"
  ? result.status === "ready"
  : ["sent", "no_recipients"].includes(result.status));
console.log(JSON.stringify({ date, kind, healthy, results }, null, 2));
process.exitCode = healthy ? 0 : 1;
