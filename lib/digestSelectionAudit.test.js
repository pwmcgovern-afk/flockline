import { describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { saveSelectionAudit } from "./digestSelectionAudit.js";
describe("bounded selection audit", () => {
  it("stores every decision separately and returns a small summary", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test");
    try {
      const ledger = Array.from({ length: 200 }, (_, i) => ({
        subId: `S123456${i}`,
        decision: "hold",
        reason: "observation_not_accepted",
      }));
      const put = vi.fn(async () => ({ url: "https://example.com/audit.gz" }));
      const result = await saveSelectionAudit(
        { version: "test", ledger },
        "northeast",
        "2026-11-16T13:06:00Z",
        { blobPut: put },
      );
      expect(result.ledger).toBeUndefined();
      expect(result.held).toHaveLength(50);
      expect(result.heldTruncated).toBe(true);
      expect(JSON.parse(gunzipSync(put.mock.calls[0][1])).ledger).toHaveLength(
        200,
      );
      expect(result.decisions.observation_not_accepted).toBe(200);
      expect(result.audit.status).toBe("saved");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
