import { describe, expect, it } from "vitest";
import { renderPage } from "./seo-entry";
import { scopeFromId } from "../shared/dailyDigest.js";
import type { SavedDailyDigest } from "./DailyDigest";

const regions = scopeFromId("west")!.regions;
const digest: SavedDailyDigest = {
  version: "daily-v1", source: "ebird", generator: "template", scopeId: "west", scopeLabel: "West", date: "2026-11-17", back: 3,
  generatedAt: "2026-11-17T14:00:00Z", publishedAt: "2026-11-17T14:00:00Z", regions,
  coverage: { requestedRegions: regions, successfulRegions: regions, failedRegions: [], limitedRegions: ["US-CA"] },
  findings: [{ kind: "notable", title: "Hudsonian Godwit", comName: "Hudsonian Godwit", detail: "One bird reported at the source beach.", speciesCode: "hudgod", subId: "S123456789", obsDt: "2026-11-17", regionCode: "US-CA", obsReviewed: false, obsValid: false }],
};
const template = '<html><head><title>Flockline</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><link rel="canonical" href=""></head><body><!--page-start--><!--page-end--></body></html>';
describe("saved daily digest pages", () => {
  it("renders full report content and exact dated sharing metadata without the map", () => {
    const html = renderPage(template, new URL("https://flockline.app/digest/west/2026-11-17/3d"), { dailyDigest: digest });
    expect(html).toContain("Hudsonian Godwit");
    expect(html).toContain("Not yet reviewed");
    expect(html).toContain("Partial source coverage");
    expect(html).toContain('rel="canonical" href="https://flockline.app/digest/west/2026-11-17/3d"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain("Share digest");
    expect(html).toContain("All daily digests");
  });
  it("keeps a current unsaved shell out of indexing while it prepares the edition", () => {
    const html = renderPage(template, new URL("https://flockline.app/digest/west/2026-11-17"), { dailyPending: true });
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain("Preparing this day");
  });
});
