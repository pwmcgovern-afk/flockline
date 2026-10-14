import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelatedMediaLookup, getRelatedSightingMedia } from "./relatedSightingMedia.js";
import { getChecklistDetails } from "./ebirdCore.js";
import { getSightingMedia } from "./sightingMedia.js";

const checklist = { subId: "S402323216", locId: "L683555", observedAt: "2026-10-14 14:21" };
const report = { subId: "S401810869", locId: "L683555", locName: "Bryant Park", observedAt: "2026-10-12 15:35" };
const photo = { assetId: "666749436", speciesCode: "sora", subId: report.subId, credit: "Helen Wang" };
const input = (reports = [report]) => ({ checklist, speciesCode: "sora", reporting: { reports } });
const sourceChecklist = (extra = {}) => ({ ...report, observation: { speciesCode: "sora", media: { photos: 1 } }, ...extra });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("recent photos at the exact eBird location", () => {
  it("uses the four independently verified Bryant Park photos without network requests", async () => {
    const result = await getRelatedSightingMedia(input());
    expect(result.map(item => item.assetId)).toEqual(["666749436", "666749437", "666749438", "666749439"]);
    expect(result.every(item => item.match === "location" && item.subId === report.subId && item.locId === checklist.locId)).toBe(true);
  });

  it("rejects wrong species, locations, unknown dates, old dates, future dates, and the featured checklist", async () => {
    const valid = { ...photo, ...report, observedAt: "2026-10-07" };
    const getChecklist = vi.fn();
    const lookup = createRelatedMediaLookup({ getChecklist, verified: [
      { ...valid, speciesCode: "virrai" }, { ...valid, locId: "L999" },
      { ...valid, observedAt: null }, { ...valid, observedAt: "2026-10-06" },
      { ...valid, observedAt: "2026-10-15" }, { ...valid, observedAt: "2026-02-30" },
      { ...valid, subId: checklist.subId }, valid,
    ] });
    expect(await lookup(input([]))).toEqual([{ ...valid, match: "location" }]);
    expect(getChecklist).not.toHaveBeenCalled();
    expect(await lookup({ ...input([]), checklist: { ...checklist, locId: null } })).toEqual([]);
    expect(await lookup({ ...input([]), checklist: { ...checklist, observedAt: null } })).toEqual([]);
  });

  it("confirms a candidate's species, exact location, date and photo count before using its photos", async () => {
    const getChecklist = vi.fn().mockResolvedValue(sourceChecklist());
    const getMedia = vi.fn().mockResolvedValue({ photos: [
      { ...photo, match: "checklist" }, { ...photo, assetId: "666749437", match: "species" },
      { ...photo, assetId: "666749438", speciesCode: "virrai", match: "checklist" },
      { ...photo, assetId: "666749439", subId: checklist.subId, match: "checklist" },
    ] });
    const lookup = createRelatedMediaLookup({ verified: [], getChecklist, getMedia });
    expect(await lookup(input())).toEqual([{ ...photo, match: "location", locId: report.locId, locName: report.locName, observedAt: report.observedAt }]);
    expect(getChecklist).toHaveBeenCalledWith({ subId: report.subId, species: "sora" }, undefined, { signal: expect.any(AbortSignal) });
    expect(getMedia).toHaveBeenCalledWith(report.subId, "sora", 1, { taxonCode: "sora", signal: expect.any(AbortSignal) });
  });

  it("uses an official reportAs match to show a related subspecies photograph on its canonical species page", async () => {
    const subId = "S402321234";
    const related = { ...report, subId };
    const apiFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/product/checklist/view/")) return Response.json({
        subId, locId: report.locId, obsDt: report.observedAt,
        obs: [{ speciesCode: "redcro2", mediaCounts: { P: 1 } }],
      });
      expect(url.pathname).toBe("/v2/ref/taxonomy/ebird");
      expect(url.searchParams.get("species")).toBe("redcro2");
      return Response.json([{ speciesCode: "redcro2", reportAs: "redcro", category: "issf" }]);
    });
    const getMedia = vi.fn((id, species, count, options) => getSightingMedia(id, species, count, {
      ...options, read: async () => null, blobPut: async () => {}, defer: () => {},
      fetcher: async () => new Response(`<h1>Checklist ${subId}</h1><section id="redcro2"><div data-media-id="666123456" data-media-speciescode="redcro2" data-media-mediatype="P" data-media-userdisplayname="Photographer"></div></section>`),
    }));
    const lookup = createRelatedMediaLookup({ verified: [], getMedia,
      getChecklist: (query, _key, options) => getChecklistDetails(query, "test-key", options),
    });
    const result = await lookup({ ...input([related]), speciesCode: "redcro" });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{
      assetId: "666123456", speciesCode: "redcro", subId, credit: "Photographer", match: "location",
      locId: report.locId, locName: report.locName, observedAt: report.observedAt,
    }]);
    expect(getMedia).toHaveBeenCalledWith(subId, "redcro", 1, { taxonCode: "redcro2", signal: expect.any(AbortSignal) });
  });

  it.each([
    { locId: "L999" }, { observedAt: "2026-10-15" }, { observedAt: "2026-10-06" },
    { observation: { speciesCode: "virrai", media: { photos: 4 } } },
    { observation: { speciesCode: "redcro2", reportAsSpeciesCode: "redcro", media: { photos: 4 } } },
    { observation: { speciesCode: "sora", media: { photos: 0, videos: 1 } } },
  ])("rejects conflicting API metadata or absent photos: %j", async (extra) => {
    const getMedia = vi.fn();
    const lookup = createRelatedMediaLookup({ verified: [], getMedia, getChecklist: async () => sourceChecklist(extra) });
    expect(await lookup(input())).toEqual([]);
    expect(getMedia).not.toHaveBeenCalled();
  });

  it("checks only three distinct matching reports already present in the supplied snapshot", async () => {
    const getChecklist = vi.fn().mockRejectedValue(new Error("Unavailable"));
    const lookup = createRelatedMediaLookup({ verified: [], getChecklist });
    const eligible = Array.from({ length: 6 }, (_, index) => ({ ...report, subId: `S40181086${index}` }));
    expect(await lookup(input([
      { ...report, subId: "S999999991", locId: "L999" },
      { ...report, subId: "S999999992", observedAt: "2026-10-15" },
      { ...report, subId: "S999999993", speciesCode: "virrai" },
      eligible[0], ...eligible,
    ]))).toEqual([]);
    expect(getChecklist).toHaveBeenCalledTimes(3);
    expect(new Set(getChecklist.mock.calls.map(([query]) => query.subId)).size).toBe(3);
  });

  it("stops waiting and cancels source requests at the shared deadline", async () => {
    vi.useFakeTimers();
    let signal;
    const getChecklist = vi.fn((_query, _key, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const lookup = createRelatedMediaLookup({ verified: [], getChecklist, timeoutMs: 25 });
    const pending = lookup(input());
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual([]);
    expect(signal.aborted).toBe(true);
  });

  it("keeps completed photos when another candidate times out and deduplicates shared media", async () => {
    vi.useFakeTimers();
    const duplicate = { ...report, subId: "S401810870" };
    const hanging = { ...report, subId: "S401810871" };
    const getChecklist = vi.fn(async ({ subId }) => subId === hanging.subId
      ? new Promise(() => {}) : sourceChecklist({ subId }));
    const getMedia = vi.fn(async (subId) => ({ photos: [{ ...photo, subId, match: "checklist" }] }));
    const lookup = createRelatedMediaLookup({ verified: [], getChecklist, getMedia, timeoutMs: 25 });
    const pending = lookup(input([report, duplicate, hanging]));
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ assetId: photo.assetId, subId: report.subId, match: "location" });
  });

  it("bounds cache entries and retries unknown results after a short lifetime", async () => {
    let time = 0;
    const getChecklist = vi.fn().mockRejectedValue(new Error("Unavailable"));
    const lookup = createRelatedMediaLookup({ verified: [], getChecklist, now: () => time, maxEntries: 2 });
    await lookup(input());
    await lookup(input());
    expect(getChecklist).toHaveBeenCalledTimes(1);
    time = 60001;
    await lookup(input());
    expect(getChecklist).toHaveBeenCalledTimes(2);
    for (const subId of ["S402323217", "S402323218"]) await lookup({ ...input(), checklist: { ...checklist, subId } });
    await lookup(input());
    expect(getChecklist).toHaveBeenCalledTimes(5);
  });
});
