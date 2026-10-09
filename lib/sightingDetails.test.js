import { describe, it, expect, vi } from "vitest";
import { excerpt, getSightingDetails } from "./sightingDetails.js";
import { getSightingMedia, parseChecklistPhotos } from "./sightingMedia.js";
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
  getMedia: vi.fn().mockResolvedValue({ status: "unavailable", photos: [] }),
  illustrate: vi.fn().mockImplementation(async (x) => x),
});
describe("sighting details", () => {
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
});
describe("Cornell photo lookup", () => {
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
});
