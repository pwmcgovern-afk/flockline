import { describe, expect, it, vi } from "vitest";
import { addBirdIllustrations, resolveBirdIllustration } from "./birdIllustrations.js";

const currentRoundup = {
  findings: [
    { speciesCode: "brnboo", comName: "Brown Booby" },
    { speciesCode: "bbwduc", comName: "Black-bellied Whistling-Duck" },
    { speciesCode: "stisan", comName: "Stilt Sandpiper" },
    { speciesCode: "woosto", comName: "Wood Stork" },
    { speciesCode: "libher", comName: "Little Blue Heron" },
    { speciesCode: "sancra", comName: "Sandhill Crane" },
    { speciesCode: "baisan", comName: "Baird's Sandpiper" },
    { speciesCode: "wispet", comName: "Wilson's Storm-Petrel" }
  ]
};

// Cache-only options for tests that exercise the curated set without touching
// the Blob store or the image gateway.
const offline = { listGenerated: async () => new Map() };

describe("bird digest illustrations", () => {
  it("covers every bird in the curated Northeast illustration set", async () => {
    const illustrated = await addBirdIllustrations(currentRoundup, "https://flockline.app", offline);

    expect(illustrated.findings).toHaveLength(8);
    expect(illustrated.findings.every((finding) => finding.image?.kind === "species-illustration"))
      .toBe(true);
    expect(illustrated.findings.map((finding) => finding.image.url)).toEqual([
      "https://flockline.app/digest-illustrations/brnboo-v1.jpg",
      "https://flockline.app/digest-illustrations/bbwduc-v1.jpg",
      "https://flockline.app/digest-illustrations/stisan-v1.jpg",
      "https://flockline.app/digest-illustrations/woosto-v1.jpg",
      "https://flockline.app/digest-illustrations/libher-v1.jpg",
      "https://flockline.app/digest-illustrations/sancra-v1.jpg",
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

  it("leaves an unresolvable species text-only instead of falling back to a photo", async () => {
    const finding = {
      speciesCode: "newbir1",
      comName: "New Bird",
      image: { url: "https://example.com/photo.jpg", kind: "photograph" }
    };
    const roundup = { findings: [finding] };

    expect(resolveBirdIllustration(finding)).toBeNull();
    expect(await addBirdIllustrations(roundup, "https://flockline.app", offline)).toEqual({
      findings: [{ speciesCode: "newbir1", comName: "New Bird" }]
    });
  });

  it("serves previously generated plates from the Blob cache", async () => {
    const roundup = { findings: [{ speciesCode: "swtkit", comName: "Swallow-tailed Kite" }] };
    const illustrated = await addBirdIllustrations(roundup, "https://flockline.app", {
      listGenerated: async () => new Map([["swtkit", "https://blob.test/illustrations/swtkit-v1.jpg"]])
    });

    expect(illustrated.findings[0].image).toEqual({
      url: "https://blob.test/illustrations/swtkit-v1.jpg",
      alt: "Stylized field-guide illustration of a Swallow-tailed Kite",
      kind: "species-illustration"
    });
  });

  it("generates a missing plate once per species when asked, within budget", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    process.env.AI_GATEWAY_API_KEY = "gw_test";
    try {
      const generate = vi.fn(async ({ speciesCode, comName }) => ({
        speciesCode,
        url: `https://blob.test/illustrations/${speciesCode}-v1.jpg`,
        alt: `Stylized field-guide illustration of a ${comName}`
      }));
      const roundup = {
        findings: [
          { speciesCode: "swtkit", comName: "Swallow-tailed Kite" },
          { speciesCode: "swtkit", comName: "Swallow-tailed Kite" },
          { speciesCode: "wantat1", comName: "Wandering Tattler" },
          { speciesCode: "kenwar", comName: "Kentucky Warbler" }
        ]
      };

      const illustrated = await addBirdIllustrations(roundup, "https://flockline.app", {
        generateMissing: true,
        generationBudget: 2,
        listGenerated: async () => new Map(),
        generate
      });

      // Duplicate species collapse to one call; the budget caps the rest.
      expect(generate).toHaveBeenCalledTimes(2);
      expect(illustrated.findings[0].image?.url).toContain("swtkit-v1.jpg");
      expect(illustrated.findings[1].image?.url).toContain("swtkit-v1.jpg");
      expect(illustrated.findings[3].image).toBeUndefined();
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.AI_GATEWAY_API_KEY;
    }
  });

  it("survives a generation failure and keeps that species text-only", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    process.env.AI_GATEWAY_API_KEY = "gw_test";
    try {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const illustrated = await addBirdIllustrations(
        { findings: [{ speciesCode: "swtkit", comName: "Swallow-tailed Kite" }] },
        "https://flockline.app",
        {
          generateMissing: true,
          listGenerated: async () => new Map(),
          generate: async () => { throw new Error("gateway down"); }
        }
      );

      expect(illustrated.findings[0].image).toBeUndefined();
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.AI_GATEWAY_API_KEY;
    }
  });
});
