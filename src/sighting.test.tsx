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
