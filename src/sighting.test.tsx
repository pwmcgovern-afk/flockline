import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import SightingPage, { type SightingDetails } from "./SightingPage";
import { renderPage } from "./seo-entry";
import { readFileSync } from "node:fs";
const sighting: SightingDetails = {
  finding: {
    kind: "rarity",
    title: "A plover",
    detail: "Recent reports",
    speciesCode: "corplo",
    comName: "Common Ringed Plover",
    sciName: "Charadrius hiaticula",
    subId: "S394925341",
    locName: "Odiorne Point",
  },
  checklist: {
    source: "ebird",
    subId: "S394925341",
    locId: "L168335",
    observedAt: "2026-09-21 08:49",
    observerName: "Toni Taylor",
    protocolId: "P22",
    protocolLabel: "Traveling",
    durationMinutes: 40,
    distanceKm: 0.12,
    numObservers: 1,
    numSpecies: 7,
    allObsReported: true,
    checklistComments: null,
    observation: {
      speciesCode: "corplo",
      count: "1",
      comments: null,
      breedingCode: null,
      exoticCategory: null,
      media: { photos: 4, audio: 0, videos: 0 },
    },
  },
  observationExcerpt: "Continuing rarity. Immature. Photos",
  checklistExcerpt: "",
  media: {
    status: "ready",
    photos: [
      {
        assetId: "665344218",
        speciesCode: "corplo",
        subId: "S394925341",
        credit: "Toni Taylor",
        match: "checklist",
      },
    ],
  },
};
describe("sighting pages", () => {
  it("renders real source embeds, notes, credit, and local observation time on the server", () => {
    const html = renderToStaticMarkup(
      <SightingPage
        pathname="/sightings/S394925341/corplo"
        initial={sighting}
      />,
    );
    expect(html).toContain(
      'src="https://macaulaylibrary.org/asset/665344218/embed"',
    );
    expect(html).toContain("Photographed on this checklist");
    expect(html).toContain("Toni Taylor");
    expect(html).toContain("Continuing rarity. Immature. Photos");
    expect(html).toContain("8:49 AM local time");
  });
  it("labels reference photos so they cannot be confused with this sighting", () => {
    const data = {
      ...sighting,
      media: {
        ...sighting.media,
        photos: [{ ...sighting.media.photos[0], match: "species" as const }],
      },
    };
    const html = renderToStaticMarkup(
      <SightingPage pathname="/sightings/S394925341/corplo" initial={data} />,
    );
    expect(html).toContain("Reference photograph from a different report");
    expect(html).not.toContain("Photographed on this checklist");
  });
  it("shows the checklist count once without mixing in regional report totals or maxima", () => {
    const data = {
      ...sighting,
      finding: {
        ...sighting.finding,
        howMany: 2,
        detail: "27 notable reports in 2 states, with up to 2 birds in a single report.",
      },
    };
    const html = renderToStaticMarkup(
      <SightingPage pathname="/sightings/S394925341/corplo" initial={data} />,
    );
    expect(html.match(/1 bird reported/g)).toHaveLength(1);
    expect(html).not.toContain(data.finding.detail);
    expect(html).not.toContain("2 birds reported");
    expect(html).not.toContain("Regional overview");
    expect(html).toContain('<details class="sighting-checklist-details">');
  });
  it.each([
    ["X", "Bird present · Count not supplied"],
    [null, "Bird present · Count not supplied"],
    ["2-4", "2-4 birds reported"],
    ["3", "3 birds reported"],
  ])("preserves the source count %s without inventing a precise total", (count, label) => {
    const data = {
      ...sighting,
      checklist: {
        ...sighting.checklist,
        durationMinutes: null,
        distanceKm: null,
        observation: { ...sighting.checklist.observation!, count },
      },
    };
    const html = renderToStaticMarkup(
      <SightingPage pathname="/sightings/S394925341/corplo" initial={data} />,
    );
    expect(html).toContain(label!);
    expect(html).not.toContain("Time in the field");
    expect(html).not.toContain("Distance covered");
  });
  it("separates checklist frequency from individual birds and links every counted report", () => {
    const reporting: SightingDetails["reporting"] = {
      timing: "published", scopeLabel: "Northeast", back: 7, asOf: "2026-09-26T20:00:00Z", partial: false,
      reports: [
        { subId: "S394925341", observedAt: "2026-09-21 08:49", locName: "Odiorne Point", count: "1" },
        { subId: "S394925342", observedAt: "2026-09-21 09:00", locName: "The harbor", count: "2" },
        { subId: "S394925343", observedAt: "2026-09-22", locName: "The beach", count: null },
      ],
    };
    const html = renderToStaticMarkup(<SightingPage pathname="/sightings/S394925341/corplo" initial={{ ...sighting, reporting }} />);
    expect(html).toContain("1 bird reported");
    expect(html).toContain("3 reported sightings");
    expect(html).toContain("On 3 eBird checklists");
    expect(html).toContain("7-day window ending September 26, 2026");
    expect(html).toContain("Each checklist counts as one reported sighting");
    expect(html).toContain("same birds or outing");
    expect(html).toContain("featured checklist is included");
    expect(html).toContain("Present, count not supplied");
    for (const report of reporting.reports) expect(html).toContain(`href="https://ebird.org/checklist/${report.subId}"`);
  });
  it("distinguishes recent partial or empty feeds from historical totals and absence", () => {
    const html = renderToStaticMarkup(<SightingPage pathname="/sightings/S394925341/corplo" initial={{ ...sighting, reporting: {
      timing: "recent", scopeLabel: "Northeast", back: 7, asOf: "2026-09-26T20:00:00Z", partial: true, reports: [],
    } }} />);
    expect(html).toContain("Partial coverage");
    expect(html).toContain("outside this feed snapshot");
    expect(html).toContain("may be newer than the featured visit");
    expect(html).toContain("0 reported sightings");
    expect(html).not.toContain("View all 0");
    expect(html).toContain("1 bird reported");
  });
  it("publishes a useful deep link and escaped initial data", () => {
    const html = renderPage(
      readFileSync("index.html", "utf8"),
      new URL("https://flockline.app/sightings/S394925341/corplo"),
      { sighting },
    );
    expect(html).toContain("Common Ringed Plover sighting · Flockline");
    expect(html).toContain(
      'href="https://flockline.app/sightings/S394925341/corplo"',
    );
    expect(html).toContain("Notes from this checklist");
  });
});
