import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/cron/weekly-digests.js";
import { runDigestEdition } from "../lib/digestDelivery.js";

vi.mock("../lib/digestDelivery.js", () => ({ runDigestEdition: vi.fn(async () => ({ status: "ready", sent: false })) }));

function response() {
  return { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe("secured regional digest handler", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T14:01:00Z"));
    for (const key of ["CRON_SECRET", "RESEND_API_KEY", "RESEND_DIGEST_SEGMENT_ID", "DIGEST_SIGNING_SECRET", "BLOB_READ_WRITE_TOKEN", "RESEND_TOPIC_NATIONWIDE", "RESEND_TOPIC_NORTHEAST", "RESEND_TOPIC_MIDWEST", "RESEND_TOPIC_SOUTH", "RESEND_TOPIC_WEST"]) vi.stubEnv(key, "test-secret");
    vi.mocked(runDigestEdition).mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("rejects an unauthenticated check before touching any provider or storage", async () => {
    const res = response();
    await handler({ method: "GET", headers: {}, query: { region: "northeast", mode: "check" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(runDigestEdition).not.toHaveBeenCalled();
  });

  it("rejects unscoped jobs and invalid modes", async () => {
    for (const query of [{}, { region: "northeast", mode: "persist-only" }]) {
      const res = response();
      await handler({ method: "GET", headers: { authorization: "Bearer test-secret" }, query }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(runDigestEdition).not.toHaveBeenCalled();
  });

  it("skips mail outside the delivery hour but permits a protected no-send check", async () => {
    vi.setSystemTime(new Date("2026-09-05T16:00:00Z"));
    const request = { method: "GET", headers: { authorization: "Bearer test-secret" }, query: { region: "northeast" } };
    const res = response();
    await handler(request, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skipped: true }));
    expect(runDigestEdition).not.toHaveBeenCalled();
    await handler({ ...request, query: { ...request.query, mode: "check" } }, response());
    expect(runDigestEdition).toHaveBeenCalledWith(expect.objectContaining({ checkOnly: true, date: "2026-09-05" }));
  });

  it("requires durable storage before permitting delivery", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = response();
    await handler({ method: "GET", headers: { authorization: "Bearer test-secret" }, query: { region: "northeast" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(runDigestEdition).not.toHaveBeenCalled();
  });
});
