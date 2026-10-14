import { describe, it, expect, vi } from "vitest";
import { excerpt, getSightingDetails } from "./sightingDetails.js";
import { getSightingMedia, parseChecklistPhotos } from "./sightingMedia.js";
import { readSightingRecord } from "./sightingStore.js";
const checklist = {
  subId: "S123456789",
  observerName: "Observer",
  checklistComments: "A checklist note",
  observation: {
    speciesCode: "osprey",
    comments: "One bird fishing",
    count: "1",
    media: { photos: 2 },
  },
};
const dependencies = () => ({
  getChecklist: vi.fn().mockResolvedValue(checklist),
  read: vi
    .fn()
    .mockResolvedValue({
      comName: "Osprey",
      locName: "The coast",
      detail: "Regional context",
    }),
  getReporting: vi.fn().mockResolvedValue(null),
  getLocation: vi.fn().mockResolvedValue(null),
  getMedia: vi.fn().mockResolvedValue({ status: "unavailable", photos: [] }),
  getRelatedMedia: vi.fn().mockResolvedValue([]),
  illustrate: vi.fn().mockImplementation(async (x) => x),
});
describe("sighting details", () => {
  it("always keeps exact checklist photos ahead of related location photos", async () => {
    const deps = dependencies();
    const media = { status: "ready", photos: [{ assetId: "12345678", match: "checklist" }] };
    deps.getMedia.mockResolvedValue(media);
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.media).toEqual(media);
    expect(deps.getRelatedMedia).not.toHaveBeenCalled();
  });
  it("prefers related location photos over a generic reference and keeps failed lookups usable", async () => {
    const deps = dependencies();
    const generic = { status: "none", photos: [{ assetId: "12345678", match: "species" }] };
    const related = [{ assetId: "87654321", match: "location", subId: "S123456788" }];
    deps.getMedia.mockResolvedValue(generic);
    deps.getRelatedMedia.mockResolvedValue(related);
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.media).toEqual({ ...generic, photos: related });
    expect(deps.getRelatedMedia).toHaveBeenCalledWith({ checklist, speciesCode: "osprey", reporting: null });
    expect(deps.illustrate).not.toHaveBeenCalled();
    deps.getRelatedMedia.mockRejectedValue(new Error("Unavailable"));
    expect((await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps)).media).toEqual(generic);
  });
  it("returns source facts with bounded attributed excerpts, without full comments", async () => {
    const result = await getSightingDetails(
      { subId: checklist.subId, species: "osprey" },
      dependencies(),
    );
    expect(result.finding.comName).toBe("Osprey");
    expect(result.observationExcerpt).toBe("One bird fishing");
    expect(result.checklistExcerpt).toBe("A checklist note");
    expect(result.checklist.observation.comments).toBeNull();
    expect(result.checklist.checklistComments).toBeNull();
    expect(excerpt(Array(40).fill("bird").join(" ")).split(/\s+/)).toHaveLength(
      25,
    );
  });
  it("uses saved report evidence without fetching today's feed", async () => {
    const deps = dependencies();
    const reporting = { reports: [{ subId: checklist.subId }], asOf: "2026-09-21", back: 7 };
    deps.read.mockResolvedValue({ comName: "Osprey", reporting });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.reporting).toEqual(reporting);
    expect(deps.getReporting).not.toHaveBeenCalled();
  });
  it("loads separately dated recent evidence for legacy stories and tolerates feed outages", async () => {
    const deps = dependencies();
    deps.getReporting.mockResolvedValue({ timing: "recent", reports: [], back: 7 });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.reporting).toMatchObject({ timing: "recent", reports: [] });
    deps.getReporting.mockRejectedValue(new Error("eBird unavailable"));
    const unavailable = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(unavailable.reporting).toBeNull();
    expect(unavailable.checklist.observation.count).toBe("1");
  });
  it("does not turn an arbitrary species/checklist combination into a report", async () => {
    const deps = dependencies();
    deps.getChecklist.mockResolvedValue({ ...checklist, observation: null });
    await expect(
      getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(deps.getMedia).not.toHaveBeenCalled();
  });
  it("keeps serving the verified checklist if saved story context is unavailable", async () => {
    const deps = dependencies();
    deps.read.mockRejectedValue(new Error("Blob unavailable"));
    const result = await getSightingDetails(
      { subId: checklist.subId, species: "osprey" },
      deps,
    );
    expect(result.finding.comName).toBe("Osprey");
  });
  it("removes legacy interpretation and uses the live featured count without parsing old prose", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue({
      comName: "Osprey", locName: "The coast", howMany: 99,
      title: "An irruption", detail: "Food shortages drove 99 birds south.",
      obsDt: "2026-10-10", obsValid: true, obsReviewed: false,
    });
    deps.getChecklist.mockResolvedValue({
      ...checklist, observedAt: "2026-10-11 08:30",
      observation: { ...checklist.observation, count: "X" },
    });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.finding.title).toBe("Osprey");
    expect(result.finding.detail).toBe("Osprey was reported at The coast on Oct 11, 2026. The featured checklist records presence without a count.");
    expect(result.finding).toMatchObject({ obsValid: true, obsReviewed: false, subId: checklist.subId });
    expect(JSON.stringify(result)).not.toMatch(/Food shortages|irruption/);
    expect(result.checklist.observation.count).toBe("X");
  });
  it("resolves legacy county context from the source checklist before looking up a baseline", async () => {
    const deps = dependencies();
    deps.getChecklist.mockResolvedValue({ ...checklist, locId: "L419667", observedAt: "2026-10-10 07:45" });
    deps.getLocation.mockResolvedValue({ countyCode: "US-CA-075", countyName: "San Francisco" });
    deps.getBaseline = vi.fn().mockReturnValue({ status: "unavailable", reason: "species_not_covered" });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(deps.getLocation).toHaveBeenCalledWith("L419667");
    expect(deps.getBaseline).toHaveBeenCalledWith(expect.objectContaining({ countyCode: "US-CA-075", obsDt: "2026-10-10 07:45" }));
    expect(result.finding).toMatchObject({ countyCode: "US-CA-075", countyName: "San Francisco", locName: "The coast", comName: "Osprey" });
    expect(result.checklist.observation.count).toBe("1");
  });
  it("skips lookup for a saved county and preserves the published baseline for the same observation date", async () => {
    const deps = dependencies();
    const historicalBaseline = { status: "available", datasetVersion: "published-version" };
    deps.read.mockResolvedValue({ comName: "Osprey", locName: "The coast", countyCode: "US-CA-075", obsDt: "2026-10-10 07:45", historicalBaseline });
    deps.getChecklist.mockResolvedValue({ ...checklist, observedAt: "2026-10-10 07:46" });
    deps.getBaseline = vi.fn();
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(deps.getLocation).not.toHaveBeenCalled();
    expect(deps.getBaseline).not.toHaveBeenCalled();
    expect(result.finding.historicalBaseline).toEqual(historicalBaseline);
  });
  it("recovers the exact public location when no saved sighting exists", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue(null);
    deps.getChecklist.mockResolvedValue({ ...checklist, locId: "L419667", observedAt: "2026-10-10 07:45" });
    deps.getLocation.mockResolvedValue({ locId: "L419667", locName: "Mt. Davidson", regionCode: "US-CA", region: "California", countyCode: "US-CA-075", countyName: "San Francisco" });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.finding).toMatchObject({ locId: "L419667", locName: "Mt. Davidson", region: "California", countyCode: "US-CA-075" });
    expect(result.finding.detail).toContain("at Mt. Davidson, California");
  });
  it("fills a missing place name even when a saved county already exists", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue({ comName: "Osprey", countyCode: "US-CA-075" });
    deps.getChecklist.mockResolvedValue({ ...checklist, locId: "L419667" });
    deps.getLocation.mockResolvedValue({ locId: "L419667", locName: "Mt. Davidson", countyCode: "US-CA-075" });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.finding.locName).toBe("Mt. Davidson");
    expect(deps.getLocation).toHaveBeenCalledWith("L419667");
  });
  it("discards old geographic context after an authoritative checklist location correction", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue({ comName: "Osprey", locId: "L111111", locName: "Old location", countyCode: "US-NY-061", historicalBaseline: { status: "available", datasetVersion: "old" }, obsDt: "2026-10-10" });
    deps.getChecklist.mockResolvedValue({ ...checklist, locId: "L419667", observedAt: "2026-10-10" });
    deps.getLocation.mockResolvedValue({ locId: "L419667", locName: "Mt. Davidson", countyCode: "US-CA-075" });
    deps.getBaseline = vi.fn().mockReturnValue({ status: "unavailable", reason: "species_not_covered" });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.finding).toMatchObject({ locId: "L419667", locName: "Mt. Davidson", countyCode: "US-CA-075" });
    expect(result.finding.historicalBaseline.datasetVersion).not.toBe("old");
    expect(result.finding.detail).not.toContain("Old location");
  });
  it("recalculates historical context when the source observation date changes", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue({ comName: "Osprey", locName: "The coast", countyCode: "US-CA-075", obsDt: "2026-10-07", historicalBaseline: { status: "available", datasetVersion: "old" } });
    deps.getChecklist.mockResolvedValue({ ...checklist, observedAt: "2026-10-08" });
    deps.getBaseline = vi.fn().mockReturnValue({ status: "available", datasetVersion: "updated" });
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(deps.getBaseline).toHaveBeenCalledWith(expect.objectContaining({ obsDt: "2026-10-08" }));
    expect(result.finding.historicalBaseline.datasetVersion).toBe("updated");
  });
  it("corrects an ambiguous histogram percentage in a saved same-date baseline", async () => {
    const deps = dependencies();
    const historicalBaseline = { status: "available", methodVersion: "ebird-barchart-48-v1", frequency: 0.0015,
      sourceUrl: "https://ebird.org/barchart?r=US-CA-075" };
    deps.read.mockResolvedValue({ comName: "Osprey", locName: "The coast", countyCode: "US-CA-075", obsDt: "2026-10-10", historicalBaseline });
    deps.getChecklist.mockResolvedValue({ ...checklist, observedAt: "2026-10-10 07:46" });
    deps.getBaseline = vi.fn();
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(deps.getBaseline).not.toHaveBeenCalled();
    expect(result.finding.historicalBaseline).toMatchObject({ status: "unavailable", reason: "frequency_ambiguous" });
    expect(historicalBaseline.frequency).toBe(0.0015);
    expect(historicalBaseline.status).toBe("available");
  });
  it("serves the source report when optional county resolution fails", async () => {
    const deps = dependencies();
    deps.getLocation.mockRejectedValue(new Error("eBird unavailable"));
    const result = await getSightingDetails({ subId: checklist.subId, species: "osprey" }, deps);
    expect(result.finding.comName).toBe("Osprey");
    expect(result.checklist.observation.count).toBe("1");
    expect(result.finding.countyCode).toBeUndefined();
    expect(result.finding.historicalBaseline).toMatchObject({ status: "unavailable", reason: "county_missing" });
  });
});
describe("Cornell photo lookup", () => {
  it("cancels saved metadata list and fetch operations with the media deadline", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    try {
      const controller = new AbortController();
      const prefix = "sighting-media/S123456789/osprey.json";
      const blobList = vi.fn(async () => ({ blobs: [{ pathname: prefix, url: "https://example.test/photo.json" }] }));
      let pendingSignal;
      const fetcher = vi.fn((_url, options) => {
        pendingSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      });
      const pending = readSightingRecord(prefix, { blobList, fetcher, signal: controller.signal });
      await vi.waitFor(() => expect(pendingSignal).toBeInstanceOf(AbortSignal));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      // The completed list releases its parent listener; the active content
      // fetch still receives caller cancellation immediately.
      expect(blobList.mock.calls[0][0].abortSignal.aborted).toBe(false);
      expect(pendingSignal.aborted).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
  it("extracts only photos of the requested species, with attribution", () => {
    const html =
      '<h1>Checklist S123456789</h1><section id="osprey"><div data-media-id="12345678" data-media-speciescode="osprey" data-media-mediatype="P" data-media-userdisplayname="Pat &amp; Alex"></div><div data-media-id="87654321" data-media-speciescode="osprey" data-media-mediatype="A"></div><div data-media-id="98765432" data-media-speciescode="corplo" data-media-mediatype="P"></div></section>';
    expect(parseChecklistPhotos(html, "S123456789", "osprey")).toEqual([
      {
        assetId: "12345678",
        speciesCode: "osprey",
        subId: "S123456789",
        credit: "Pat & Alex",
      },
    ]);
    expect(parseChecklistPhotos(html, "S999999999", "osprey")).toBeNull();
    expect(
      parseChecklistPhotos(
        "<h1>Making sure you're not a bot!</h1>",
        "S123456789",
        "osprey",
      ),
    ).toBeNull();
  });
  it("matches photos filed under the subspecies group the birder entered", () => {
    const html =
      '<h1>Checklist S123456789</h1><section id="brnpel1"><div data-media-id="12345678" data-media-speciescode="brnpel1" data-media-mediatype="P" data-media-userdisplayname="Pat"></div></section><section id="osprey"><div data-media-id="87654321" data-media-speciescode="osprey" data-media-mediatype="P"></div></section>';
    expect(parseChecklistPhotos(html, "S123456789", "brnpel", "brnpel1")).toEqual([
      { assetId: "12345678", speciesCode: "brnpel", subId: "S123456789", credit: "Pat" },
    ]);
    expect(parseChecklistPhotos(html, "S123456789", "brnpel")).toBeNull();
  });
  it("uses verified exact-checklist photographs without a fragile live scrape", async () => {
    const fetcher = vi.fn();
    const result = await getSightingMedia("S394925341", "corplo", 4, {
      fetcher,
      read: async () => null,
    });
    expect(result.photos).toHaveLength(4);
    expect(result.photos.every((photo) => photo.match === "checklist")).toBe(
      true,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("explicitly distinguishes a species reference photo from this report", async () => {
    const result = await getSightingMedia("S123456780", "corplo", 0, {
      read: async () => null,
    });
    expect(result.status).toBe("none");
    expect(result.photos[0].match).toBe("species");
    expect(result.photos[0].subId).not.toBe("S123456780");
  });
  it("does not mistake an upstream gate for a photo-free checklist", async () => {
    const result = await getSightingMedia("S123456781", "osprey", 2, {
      read: async () => null,
      fetcher: async () =>
        new Response("<h1>Making sure you're not a bot!</h1>"),
    });
    expect(result).toEqual({ status: "unavailable", photos: [] });
  });
  it("does not await optional media persistence before returning a discovered photo", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    try {
      const defer = vi.fn();
      const blobPut = vi.fn(() => new Promise(() => {}));
      const result = await getSightingMedia("S123456782", "osprey", 1, {
        read: async () => null, blobPut, defer,
        fetcher: async () => new Response('<h1>S123456782</h1><section id="osprey"><div data-media-id="12345678" data-media-speciescode="osprey" data-media-mediatype="P"></div></section>'),
      });
      expect(result.photos[0].assetId).toBe("12345678");
      expect(defer).toHaveBeenCalledWith(expect.any(Promise));
    } finally { vi.unstubAllEnvs(); }
  });
});
