import { describe, expect, it } from "vitest";
import { normalizeChecklistDetails } from "./checklistDetails.js";

describe("normalizeChecklistDetails", () => {
  it("keeps the useful checklist and species-level eBird details", () => {
    const details = normalizeChecklistDetails(
      {
        subId: "S372048657",
        protocolId: "P21",
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
});
