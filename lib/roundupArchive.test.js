import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getArchivedRoundup,
  listArchivedRoundups,
  normalizeArchiveDate,
  parseRoundupBlobPath,
  roundupBlobPath,
  saveRoundup
} from "./roundupArchive.js";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("archive paths", () => {
  it("builds and parses deterministic issue paths", () => {
    expect(roundupBlobPath("northeast", "2026-08-24")).toBe("roundups/northeast/2026-08-24.json");
    expect(parseRoundupBlobPath("roundups/northeast/2026-08-24.json")).toEqual({
      scopeId: "northeast",
      date: "2026-08-24"
    });
  });

  it("rejects unknown scopes and malformed dates", () => {
    expect(parseRoundupBlobPath("roundups/atlantis/2026-08-24.json")).toBeNull();
    expect(parseRoundupBlobPath("roundups/northeast/not-a-date.json")).toBeNull();
    expect(parseRoundupBlobPath("events/signup/whatever.json")).toBeNull();
    expect(normalizeArchiveDate("2026-08-24")).toBe("2026-08-24");
    expect(normalizeArchiveDate("08/24/2026")).toBeNull();
  });
});

describe("saveRoundup", () => {
  it("writes the issue to a deterministic, overwritable public blob", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const blobPut = vi.fn(async (path) => ({ url: `https://blob.test/${path}` }));

    const saved = await saveRoundup({
      scopeId: "northeast",
      generatedAt: "2026-08-24T14:00:00.000Z",
      findings: []
    }, { blobPut });

    expect(saved).toMatchObject({ scopeId: "northeast", date: "2026-08-24" });
    expect(blobPut).toHaveBeenCalledWith(
      "roundups/northeast/2026-08-24.json",
      expect.any(String),
      expect.objectContaining({ addRandomSuffix: false, allowOverwrite: true, access: "public" })
    );
  });

  it("refuses roundups without a valid scope or date", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    await expect(saveRoundup({ scopeId: "atlantis", generatedAt: "2026-08-24T14:00:00.000Z" }))
      .rejects.toThrow("scope or date");
  });

  it("refuses to run without a Blob token", async () => {
    await expect(saveRoundup({ scopeId: "northeast", generatedAt: "2026-08-24T14:00:00.000Z" }))
      .rejects.toThrow("BLOB_READ_WRITE_TOKEN");
  });
});

describe("reading the archive", () => {
  const blobs = [
    { pathname: "roundups/northeast/2026-08-17.json", url: "https://blob.test/ne-0817" },
    { pathname: "roundups/northeast/2026-08-24.json", url: "https://blob.test/ne-0824" },
    { pathname: "roundups/west/2026-08-24.json", url: "https://blob.test/we-0824" },
    { pathname: "roundups/junk/oops.txt", url: "https://blob.test/junk" }
  ];
  const blobList = vi.fn(async ({ prefix }) => ({
    blobs: blobs.filter((blob) => blob.pathname.startsWith(prefix)),
    hasMore: false
  }));

  it("derives a newest-first index from the blob listing", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const issues = await listArchivedRoundups({ blobList });
    expect(issues.map((issue) => `${issue.scopeId}/${issue.date}`)).toEqual([
      "northeast/2026-08-24",
      "west/2026-08-24",
      "northeast/2026-08-17"
    ]);
  });

  it("returns an empty index instead of failing when Blob is not configured", async () => {
    expect(await listArchivedRoundups({ blobList })).toEqual([]);
  });

  it("fetches an exact issue, the latest issue, and null for a miss", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const fetcher = vi.fn(async (url) => ({ ok: true, json: async () => ({ from: url }) }));

    const exact = await getArchivedRoundup("northeast", "2026-08-17", { blobList, fetcher });
    expect(exact).toEqual({ from: "https://blob.test/ne-0817" });

    const latest = await getArchivedRoundup("northeast", null, { blobList, fetcher });
    expect(latest).toEqual({ from: "https://blob.test/ne-0824" });

    expect(await getArchivedRoundup("northeast", "2020-01-01", { blobList, fetcher })).toBeNull();
  });
});
