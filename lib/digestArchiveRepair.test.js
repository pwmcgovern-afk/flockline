import { describe, expect, it, vi } from "vitest";
import { repairMissingDigestArchive } from "./digestArchiveRepair.js";

const date = "2026-10-12";
const regionId = "midwest";
function fixture() {
  const roundup = {
    source: "ebird", scopeId: regionId, generatedAt: `${date}T13:07:43Z`,
    findings: [{ speciesCode: "redcro", subId: "S401515472", obsDt: "2026-10-11 15:38", howMany: 2,
      locName: "Original location", image: { kind: "species-illustration", url: "https://art.public.blob.vercel-storage.com/illustrations/redcro-v1.jpg" } }],
  };
  const value = { date, region: regionId, leaseUntil: 0, status: "prepared", roundup };
  return {
    value,
    store: { read: vi.fn(async () => ({ value, etag: "original" })), write: vi.fn() },
    listArchive: vi.fn(async () => []),
    archive: vi.fn(async () => ({ url: `https://blob.test/roundups/${regionId}/${date}.json` })),
    verifyArtwork: vi.fn(async () => true),
    now: () => Date.parse("2026-10-14T12:00:00Z"),
  };
}

describe("missing digest archive recovery", () => {
  it("defaults to read-only inspection of the real saved edition", async () => {
    const f = fixture();
    const result = await repairMissingDigestArchive({ date, regionId }, f);
    expect(result).toMatchObject({ mode: "dry_run", sourceValidated: true, artworkVerified: true, findings: 1, saved: false, emailSent: false, deliveryReceiptChanged: false });
    expect(result.sourceFacts).toEqual([{ speciesCode: "redcro", subId: "S401515472", obsDt: "2026-10-11 15:38", howMany: 2, locName: "Original location" }]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it("publishes only the original snapshot when explicitly applied", async () => {
    const f = fixture();
    const original = structuredClone(f.value.roundup);
    expect(await repairMissingDigestArchive({ date, regionId, apply: true }, f)).toMatchObject({ saved: true, emailSent: false, deliveryReceiptChanged: false });
    expect(f.archive).toHaveBeenCalledExactlyOnceWith(original);
    expect(f.value.roundup).toEqual(original);
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it.each([
    value => { value.date = "2026-10-05"; },
    value => { value.region = "west"; },
    value => { value.roundup.generatedAt = "2026-10-14T13:00:00Z"; },
    value => { value.roundup.scopeId = "west"; },
    value => { value.roundup.source = "demo"; },
    value => { value.roundup.findings[0].subId = "unknown"; },
    value => { value.roundup.findings[0].obsDt = "2026-10-13"; },
    value => { delete value.roundup.findings[0].image; },
  ])("refuses mismatched, reconstructed, or incomplete snapshots", async change => {
    const f = fixture();
    change(f.value);
    await expect(repairMissingDigestArchive({ date, regionId, apply: true }, f)).rejects.toThrow();
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("refuses active work, present-day recovery, or an already published issue", async () => {
    const f = fixture();
    f.value.leaseUntil = f.now() + 1000;
    await expect(repairMissingDigestArchive({ date, regionId, apply: true }, f)).rejects.toThrow("active worker");
    f.value.leaseUntil = 0;
    await expect(repairMissingDigestArchive({ date: "2026-10-14", regionId, apply: true }, f)).rejects.toThrow("past edition");
    f.listArchive.mockResolvedValue([{ date, scopeId: regionId }]);
    await expect(repairMissingDigestArchive({ date, regionId, apply: true }, f)).rejects.toThrow("already exists");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("requires reachable artwork and a source version unchanged during inspection", async () => {
    const f = fixture();
    f.verifyArtwork.mockResolvedValueOnce(false);
    await expect(repairMissingDigestArchive({ date, regionId, apply: true }, f)).rejects.toThrow("artwork could not be verified");
    f.store.read.mockResolvedValueOnce({ value: f.value, etag: "original" }).mockResolvedValueOnce({ value: f.value, etag: "changed" });
    await expect(repairMissingDigestArchive({ date, regionId, apply: true }, f)).rejects.toThrow("receipt changed");
    expect(f.archive).not.toHaveBeenCalled();
  });
});
