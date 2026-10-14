import { afterEach, describe, expect, it, vi } from "vitest";
import { getInsights } from "./ebirdCore.js";
import { getArchivedRoundup } from "./roundupArchive.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("historical context at publication boundaries", () => {
  it("joins featured county and date to the baseline without treating nearby counties as equivalent", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { speciesCode: "redcro2", comName: "Red Crossbill", subId: "S401148419", obsDt: "2026-10-10 08:00", subnational1Code: "US-CA", subnational2Code: "US-CA-075", subnational2Name: "San Francisco", locName: "Mt. Davidson", howMany: 16 },
      { speciesCode: "rebnut", comName: "Red-breasted Nuthatch", subId: "S401148420", obsDt: "2026-10-10 08:00", subnational1Code: "US-CA", subnational2Code: "US-CA-081", subnational2Name: "San Mateo", locName: "San Mateo test location", howMany: 1 },
      { speciesCode: "sora", comName: "Sora", subId: "S402323216", obsDt: "2026-10-14 14:21", subnational1Code: "US-NY", subnational2Code: "US-NY-061", subnational2Name: "New York", locName: "Bryant Park", howMany: 1 },
      { speciesCode: "amerob", comName: "American Robin", subId: "S401148421", obsDt: "2026-10-10 08:00", subnational1Code: "US-CA", subnational2Code: "US-CA-001", subnational2Name: "Alameda", locName: "Alameda test location", howMany: 1 },
    ]), { headers: { "content-type": "application/json" } })));
    const result = await getInsights({ regions: "US-CA,US-NY", back: "7", fresh: "1" }, "test-key");
    expect(result.findings.find((finding) => finding.speciesCode === "redcro2")).toMatchObject({
      countyCode: "US-CA-075",
      historicalBaseline: { status: "available", speciesCode: "redcro", frequency: 0.0028482, checklistCount: 3511 },
    });
    expect(result.findings.find((finding) => finding.speciesCode === "rebnut").historicalBaseline)
      .toMatchObject({ status: "available", area: { code: "US-CA-081" }, frequency: 0.0367446, checklistCount: 3293 });
    expect(result.findings.find((finding) => finding.speciesCode === "sora").historicalBaseline)
      .toMatchObject({ status: "available", area: { code: "US-NY-061" }, frequency: 0.0049001, checklistCount: 5306 });
    expect(result.findings.find((finding) => finding.speciesCode === "amerob").historicalBaseline)
      .toMatchObject({ status: "unavailable", reason: "county_not_covered" });
  });

  it("enriches legacy records only with explicit county evidence and preserves a published baseline version", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const previous = { status: "available", datasetVersion: "published-version", frequency: 0.1 };
    const saved = { findings: [
      { speciesCode: "redcro", comName: "Red Crossbill", countyCode: "US-CA-075", obsDt: "2026-10-10" },
      { speciesCode: "rebnut", comName: "Red-breasted Nuthatch", obsDt: "2026-10-10" },
      { speciesCode: "osprey", historicalBaseline: previous },
    ] };
    const result = await getArchivedRoundup("west", "2026-10-12", {
      blobList: async () => ({ blobs: [{ pathname: "roundups/west/2026-10-12.json", url: "https://example.test/issue" }] }),
      fetcher: async () => ({ ok: true, json: async () => saved }),
    });
    expect(result.findings[0].historicalBaseline).toMatchObject({ status: "available", frequency: 0.0028482 });
    expect(result.findings[1].historicalBaseline).toMatchObject({ status: "unavailable", reason: "county_missing" });
    expect(result.findings[2].historicalBaseline).toEqual(previous);
    expect(saved.findings[0]).not.toHaveProperty("historicalBaseline");
  });
});
