import { describe, expect, it, vi } from "vitest";
import { addBirdImages, resolveBirdImage } from "./birdImages.js";

const finding = {
  speciesCode: "stisan",
  comName: "Stilt Sandpiper",
  sciName: "Calidris himantopus"
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function wikipediaPayload() {
  return {
    query: { pages: [{ title: "Calidris himantopus", pageimage: "Stilt_Sandpiper.jpg" }] }
  };
}

function commonsPayload() {
  return {
    query: {
      pages: [{
        title: "File:Stilt_Sandpiper.jpg",
        imageinfo: [{
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Stilt.jpg/960px-Stilt.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Stilt_Sandpiper.jpg",
          extmetadata: {
            Artist: { value: '<a href="https://example.com">Andy Reago &amp; Chrissy McClarren</a>' },
            LicenseShortName: { value: "CC BY 2.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by/2.0" }
          }
        }]
      }]
    }
  };
}

describe("bird digest images", () => {
  it("resolves a free Wikipedia page image with Commons credit", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      return url.hostname === "en.wikipedia.org"
        ? response(wikipediaPayload())
        : response(commonsPayload());
    });

    const image = await resolveBirdImage(finding, { fetchImpl, cache: new Map() });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(image).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Stilt.jpg/960px-Stilt.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Stilt_Sandpiper.jpg",
      creator: "Andy Reago & Chrissy McClarren",
      license: "CC BY 2.0",
      licenseUrl: "https://creativecommons.org/licenses/by/2.0",
      alt: "Stilt Sandpiper bird photograph",
      sourceName: "Wikimedia Commons"
    });
  });

  it("caches a species image for repeated findings", async () => {
    const fetchImpl = vi.fn(async (input) => new URL(String(input)).hostname === "en.wikipedia.org"
      ? response(wikipediaPayload())
      : response(commonsPayload()));
    const cache = new Map();

    await resolveBirdImage(finding, { fetchImpl, cache, now: 100 });
    await resolveBirdImage(finding, { fetchImpl, cache, now: 200 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the roundup usable when one image lookup fails", async () => {
    const fetchImpl = vi.fn(async () => response({ error: "temporary" }, 503));
    const roundup = { findings: [finding] };

    await expect(addBirdImages(roundup, { fetchImpl, cache: new Map() }))
      .resolves.toEqual(roundup);
  });
});
