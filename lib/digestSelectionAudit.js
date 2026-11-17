import { gzipSync } from "node:zlib";
import { put } from "@vercel/blob";

// Full candidate decisions live separately so weekly API responses and delivery
// lease receipts do not grow with every observation in the country.
export async function saveSelectionAudit(
  selection,
  scopeId,
  generatedAt,
  { blobPut = put } = {},
) {
  const { ledger, ...summary } = selection;
  summary.decisions = {};
  for (const item of ledger)
    summary.decisions[item.reason] = (summary.decisions[item.reason] || 0) + 1;
  summary.held = ledger.filter((item) => item.decision === "hold").slice(0, 50);
  summary.heldTruncated =
    ledger.filter((item) => item.decision === "hold").length >
    summary.held.length;
  summary.audit = { status: "not_configured" };
  if (!process.env.BLOB_READ_WRITE_TOKEN) return summary;
  try {
    const result = await blobPut(
      `digest-selection/${scopeId}/${generatedAt.replace(/[:.]/g, "-")}.json.gz`,
      gzipSync(JSON.stringify(selection)),
      {
        access: "public",
        contentType: "application/gzip",
        addRandomSuffix: true,
        abortSignal: AbortSignal.timeout(5000),
      },
    );
    summary.audit = { status: "saved", url: result.url };
  } catch {
    summary.audit = { status: "unavailable" };
    console.error(
      JSON.stringify({ event: "digest_selection_audit_failed", scopeId }),
    );
  }
  return summary;
}
