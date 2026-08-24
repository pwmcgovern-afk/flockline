import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIllustrationPrompt,
  describeSpeciesForArt,
  generateBirdIllustration,
  generatedIllustrationPath,
  generationConfigured,
  listGeneratedIllustrations
} from "./illustrationGeneration.js";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
});

describe("configuration and paths", () => {
  it("needs both a Blob token and gateway auth", () => {
    expect(generationConfigured({})).toBe(false);
    expect(generationConfigured({ BLOB_READ_WRITE_TOKEN: "t" })).toBe(false);
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(generationConfigured({ BLOB_READ_WRITE_TOKEN: "t", AI_GATEWAY_API_KEY: "k" })).toBe(true);
    expect(generationConfigured({ BLOB_READ_WRITE_TOKEN: "t", VERCEL_OIDC_TOKEN: "o" })).toBe(true);
  });

  it("builds deterministic cache paths and includes the shared art direction", () => {
    expect(generatedIllustrationPath("swtkit")).toBe("illustrations/swtkit-v1.jpg");
    const prompt = buildIllustrationPrompt("Swallow-tailed Kite, forked tail.");
    expect(prompt).toContain("never photorealistic");
    expect(prompt).toContain("not a depiction of a reported individual");
    expect(prompt).toContain("Swallow-tailed Kite, forked tail.");
  });
});

describe("listGeneratedIllustrations", () => {
  it("maps species codes to blob URLs and ignores foreign paths", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    const blobList = vi.fn(async () => ({
      blobs: [
        { pathname: "illustrations/swtkit-v1.jpg", url: "https://blob.test/swtkit" },
        { pathname: "illustrations/readme.txt", url: "https://blob.test/junk" }
      ],
      hasMore: false
    }));
    const generated = await listGeneratedIllustrations({ blobList });
    expect(generated.get("swtkit")).toBe("https://blob.test/swtkit");
    expect(generated.size).toBe(1);
  });
});

describe("describeSpeciesForArt", () => {
  it("falls back to a named, accuracy-demanding sentence without a key", async () => {
    const description = await describeSpeciesForArt(
      { comName: "Swallow-tailed Kite", sciName: "Elanoides forficatus" },
      { environment: {} }
    );
    expect(description).toContain("Swallow-tailed Kite");
    expect(description).toContain("Elanoides forficatus");
    expect(description).toContain("diagnostic field marks");
  });

  it("prefixes the model's sentence with the species name", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: "A striking black-and-white raptor with a deeply forked tail." }] })
    }));
    const description = await describeSpeciesForArt(
      { comName: "Swallow-tailed Kite", sciName: "Elanoides forficatus" },
      { fetcher, environment: { ANTHROPIC_API_KEY: "k" } }
    );
    expect(description).toBe(
      "Swallow-tailed Kite (Elanoides forficatus): A striking black-and-white raptor with a deeply forked tail."
    );
  });
});

describe("generateBirdIllustration", () => {
  it("renders through the gateway and caches the JPEG at a deterministic path", async () => {
    const environment = { BLOB_READ_WRITE_TOKEN: "t", AI_GATEWAY_API_KEY: "gw_key" };
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    const image = Buffer.from("jpeg-bytes");
    const fetcher = vi.fn(async (url) => {
      expect(url).toContain("ai-gateway.vercel.sh");
      return { ok: true, json: async () => ({ data: [{ b64_json: image.toString("base64") }] }) };
    });
    const blobPut = vi.fn(async (path) => ({ url: `https://blob.test/${path}` }));

    const made = await generateBirdIllustration(
      { speciesCode: "SWTKIT", comName: "Swallow-tailed Kite", sciName: "Elanoides forficatus" },
      { fetcher, blobPut, environment, describe: async () => "described species" }
    );

    expect(made).toEqual({
      speciesCode: "swtkit",
      url: "https://blob.test/illustrations/swtkit-v1.jpg",
      alt: "Stylized field-guide illustration of a Swallow-tailed Kite"
    });
    const [path, body, options] = blobPut.mock.calls[0];
    expect(path).toBe("illustrations/swtkit-v1.jpg");
    expect(Buffer.compare(body, image)).toBe(0);
    expect(options).toMatchObject({ contentType: "image/jpeg", addRandomSuffix: false });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.output_format).toBe("jpeg");
    expect(request.prompt).toContain("described species");
  });

  it("throws a readable error when the gateway declines", async () => {
    const environment = { BLOB_READ_WRITE_TOKEN: "t", AI_GATEWAY_API_KEY: "gw_key" };
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    const fetcher = vi.fn(async () => ({ ok: false, status: 402, text: async () => "insufficient credits" }));

    await expect(generateBirdIllustration(
      { speciesCode: "swtkit", comName: "Swallow-tailed Kite" },
      { fetcher, environment, describe: async () => "x" }
    )).rejects.toThrow("Image generation failed (402)");
  });
});
