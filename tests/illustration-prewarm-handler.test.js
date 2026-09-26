import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/cron/illustration-prewarm.js";
import { prepareDigestIllustrations } from "../lib/digestPreparation.js";
vi.mock("../lib/digestPreparation.js", () => ({ prepareDigestIllustrations: vi.fn() }));
const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
const request = (extraHeaders = {}) => ({ method: "GET", headers: { authorization: "Bearer cron-test", ...extraHeaders }, query: { region: "northeast" } });
describe("illustration cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-test");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "expired-build-token");
    vi.mocked(prepareDigestIllustrations).mockReset().mockResolvedValue({ status: "prepared", findings: 6, illustrations: 6, unresolved: [] });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires authorization before preparing anything", async () => {
    const res = response();
    await handler(request({ authorization: "wrong" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prepareDigestIllustrations).not.toHaveBeenCalled();
  });
  it("uses the fresh request OIDC token without mutating the process environment", async () => {
    const res = response();
    await handler(request({ "x-vercel-oidc-token": "fresh-runtime-token" }), res);
    expect(prepareDigestIllustrations).toHaveBeenCalledWith(expect.objectContaining({
      region: expect.objectContaining({ id: "northeast" }),
      environment: expect.objectContaining({ VERCEL_OIDC_TOKEN: "fresh-runtime-token" })
    }));
    expect(process.env.VERCEL_OIDC_TOKEN).toBe("expired-build-token");
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("marks incomplete artwork as a retryable failure", async () => {
    vi.mocked(prepareDigestIllustrations).mockResolvedValue({ status: "awaiting_illustrations", findings: 6, illustrations: 5, unresolved: ["conwar"] });
    const res = response();
    await handler(request(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, unresolved: ["conwar"] }));
  });
  it("does not expose storage or credential failures in the response", async () => {
    vi.mocked(prepareDigestIllustrations).mockRejectedValue(new Error("Private detail"));
    const res = response();
    await handler(request(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("Private detail");
  });
});
