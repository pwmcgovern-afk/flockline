import { describe, expect, it } from "vitest";
import { addBirdIllustrations, resolveBirdIllustration } from "./birdIllustrations.js";

const currentRoundup = {
  findings: [
    { speciesCode: "brnboo", comName: "Brown Booby" },
    { speciesCode: "bbwduc", comName: "Black-bellied Whistling-Duck" },
    { speciesCode: "stisan", comName: "Stilt Sandpiper" },
    { speciesCode: "woosto", comName: "Wood Stork" },
    { speciesCode: "baisan", comName: "Baird's Sandpiper" },
    { speciesCode: "wispet", comName: "Wilson's Storm-Petrel" }
  ]
};

describe("bird digest illustrations", () => {
  it("covers every bird in the current Northeast roundup", () => {
    const illustrated = addBirdIllustrations(currentRoundup, "https://flockline.app");

    expect(illustrated.findings).toHaveLength(6);
    expect(illustrated.findings.every((finding) => finding.image?.kind === "species-illustration"))
      .toBe(true);
    expect(illustrated.findings.map((finding) => finding.image.url)).toEqual([
      "https://flockline.app/digest-illustrations/brnboo-v1.jpg",
      "https://flockline.app/digest-illustrations/bbwduc-v1.jpg",
      "https://flockline.app/digest-illustrations/stisan-v1.jpg",
      "https://flockline.app/digest-illustrations/woosto-v1.jpg",
      "https://flockline.app/digest-illustrations/baisan-v1.jpg",
      "https://flockline.app/digest-illustrations/wispet-v1.jpg"
    ]);
  });

  it("uses the configured public origin for absolute email image URLs", () => {
    expect(resolveBirdIllustration(
      { speciesCode: "STISAN" },
      "https://preview.flockline.app/base/"
    )?.url).toBe("https://preview.flockline.app/digest-illustrations/stisan-v1.jpg");
  });

  it("leaves an unillustrated species text-only instead of falling back to a photo", () => {
    const finding = {
      speciesCode: "newbir1",
      comName: "New Bird",
      image: { url: "https://example.com/photo.jpg", kind: "photograph" }
    };
    const roundup = { findings: [finding] };

    expect(resolveBirdIllustration(finding)).toBeNull();
    expect(addBirdIllustrations(roundup)).toEqual({
      findings: [{ speciesCode: "newbir1", comName: "New Bird" }]
    });
  });
});
