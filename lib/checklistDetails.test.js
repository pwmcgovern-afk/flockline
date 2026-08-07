import { describe, expect, it } from "vitest";
import { normalizeChecklistDetails } from "./checklistDetails.js";

describe("normalizeChecklistDetails", () => {
  it("keeps the useful checklist and species-level eBird details", () => {
    const details = normalizeChecklistDetails(
      {
        subId: "S372048657",
        // P22 is eBird's Traveling code, which is what a 2.4km effort is.
        protocolId: "P22",
        locId: "L73470123",
        durationHrs: 1.25,
        effortDistanceKm: 2.4,
        allObsReported: true,
        subComments: "A productive seawatch.",
        obsDt: "2026-07-14 11:09",
        numObservers: 2,
        userDisplayName: "A Birder",
        numSpecies: 47,
        obs: [
          {
            speciesCode: "briter1",
            howManyStr: "1",
            obsComments: "Continuing bird off the lighthouse.",
            photoCounts: 3,
            audioCounts: 1,
            videoCounts: 0,
            obsAux: [{ fieldName: "breeding_code", auxCode: "F" }]
          }
        ]
      },
      "briter1"
    );

    expect(details).toMatchObject({
      subId: "S372048657",
      observerName: "A Birder",
      protocolLabel: "Traveling",
      durationMinutes: 75,
      distanceKm: 2.4,
      numObservers: 2,
      numSpecies: 47,
      allObsReported: true,
      observation: {
        speciesCode: "briter1",
        count: "1",
        comments: "Continuing bird off the lighthouse.",
        breedingCode: "F",
        media: { photos: 3, audio: 1, videos: 0 }
      }
    });
  });

  it("derives a species total and handles an eBird X count", () => {
    const details = normalizeChecklistDetails(
      {
        obs: [
          { speciesCode: "osprey", present: true, photoCounts: [{ count: 2 }] },
          { speciesCode: "baleag", howManyAtleast: 1, howManyAtmost: 3 }
        ]
      },
      "osprey"
    );

    expect(details.numSpecies).toBe(2);
    expect(details.observation?.count).toBe("X");
    expect(details.observation?.media.photos).toBe(2);
  });

  // These two were inverted, which put "Stationary / 48.3 km" on records that
  // were plainly traveling counts. Lock eBird's own mapping down.
  it("maps eBird protocol codes the way eBird does", () => {
    const label = (protocolId) =>
      normalizeChecklistDetails({ subId: "S1", protocolId, obs: [] }, "amerob").protocolLabel;
    expect(label("P21")).toBe("Stationary");
    expect(label("P22")).toBe("Traveling");
    expect(label("P20")).toBe("Incidental");
  });


  // The shape eBird actually sends, captured from a live checklist
  // (S380601462). We were reading obsComments and photoCounts, which eBird
  // never sends, so observer notes and photo counts were dropped on every
  // single record.
  it("reads the observer note and media counts eBird actually returns", () => {
    const details = normalizeChecklistDetails(
      {
        subId: "S380601462",
        protocolId: "P22",
        obs: [
          {
            speciesCode: "miskit",
            howManyStr: "2",
            comments: "Very fun looks at these local celebrities.",
            mediaCounts: { P: 7 }
          }
        ]
      },
      "miskit"
    );
    expect(details.observation?.comments).toBe("Very fun looks at these local celebrities.");
    expect(details.observation?.media.photos).toBe(7);
  });

});
