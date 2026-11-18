import { describe, expect, it, vi } from "vitest";
import { ensureDailyDigest, getDailyDigest } from "./dailyDigestArchive.js";
import { dailyScope, scopeFromId } from "../shared/dailyDigest.js";

const now = new Date("2026-11-17T14:00:00Z");
const address = { scopeId: "west", date: "2026-11-17", back: 1 };
function fixture() {
  const scope = scopeFromId("west");
  return {
    source: "ebird", generator: "template", back: 1, generatedAt: now.toISOString(), regions: scope.regions, scopeLabel: scope.label,
    coverage: { requestedRegions: scope.regions, successfulRegions: scope.regions, failedRegions: [] },
    findings: [{ title: "Northern Lapwing", comName: "Northern Lapwing", speciesCode: "norlap", kind: "notable", locName: "Source lake", obsDt: "2026-11-17 08:00", subId: "S123456789", regionCode: "US-CA", howMany: 1, obsValid: true, obsReviewed: false }],
  };
}
function dependencies(payload = fixture()) {
  return { now, configured: true, read: vi.fn(async () => null), build: vi.fn(async () => payload), illustrate: vi.fn(async (value) => value), blobPut: vi.fn(async () => ({ url: "https://example.test/saved" })) };
}
describe("immutable daily editions", () => {
  it("saves a dated source snapshot once with overwrite disabled and no image generation", async () => {
    const deps = dependencies();
    const snapshot = await ensureDailyDigest(address, deps);
    expect(snapshot).toMatchObject({ version: "daily-v1", date: address.date, scopeId: "west", back: 1 });
    expect(deps.blobPut.mock.calls[0][2]).toMatchObject({ allowOverwrite: false, addRandomSuffix: false });
    expect(deps.illustrate.mock.calls[0][2]).toEqual({ generateMissing: false });
    expect(deps.build.mock.calls[0][0]).toMatchObject({ fresh: "1", back: 1 });
  });
  it("returns the existing snapshot without rebuilding even on a later day", async () => {
    const deps = dependencies();
    const existing = { ...fixture(), version: "daily-v1", ...address };
    deps.read.mockResolvedValue(existing);
    deps.now = new Date("2026-11-20T14:00:00Z");
    expect(await ensureDailyDigest(address, deps)).toBe(existing);
    expect(deps.build).not.toHaveBeenCalled();
    expect(deps.blobPut).not.toHaveBeenCalled();
  });
  it("never reconstructs a missing past day or publishes a future day", async () => {
    for (const date of ["2026-11-16", "2026-11-18"]) {
      const deps = dependencies();
      await expect(ensureDailyDigest({ ...address, date }, deps)).rejects.toHaveProperty("statusCode", date < address.date ? 404 : 400);
      expect(deps.build).not.toHaveBeenCalled();
    }
  });
  it.each(["demo", "failed", "wrong-window", "wrong-day", "wrong-scope", "missing-success"])("does not persist unsupported source data: %s", async (kind) => {
    const payload = fixture();
    if (kind === "demo") payload.source = "demo";
    if (kind === "failed") payload.coverage.failedRegions = ["US-CA"];
    if (kind === "wrong-window") payload.back = 7;
    if (kind === "wrong-day") payload.generatedAt = "2026-11-16T14:00:00Z";
    if (kind === "wrong-scope") payload.regions = ["US-NY"];
    if (kind === "missing-success") payload.coverage.successfulRegions = [];
    const deps = dependencies(payload);
    await expect(ensureDailyDigest(address, deps)).rejects.toHaveProperty("statusCode", 503);
    expect(deps.blobPut).not.toHaveBeenCalled();
  });
  it("reads the winner after a competing write and leaves its contents intact", async () => {
    const deps = dependencies();
    const winner = { ...fixture(), version: "daily-v1", ...address, findings: [] };
    deps.read.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    deps.blobPut.mockRejectedValue(Object.assign(new Error("This blob already exists"), { status: 409 }));
    expect(await ensureDailyDigest(address, deps)).toBe(winner);
  });
  it("rejects a stored edition under the wrong address", async () => {
    const saved = { ...fixture(), version: "daily-v1", ...address };
    const fetcher = async () => new Response(JSON.stringify(saved));
    await expect(getDailyDigest("northeast", address.date, 1, { blobHead: async () => ({ url: "https://example.test/x", size: 500 }), fetcher })).rejects.toHaveProperty("statusCode", 503);
  });
});
