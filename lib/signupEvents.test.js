import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashSignupEmail,
  normalizeSignupSource,
  recordSignupEvent
} from "./signupEvents.js";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("normalizeSignupSource", () => {
  it("accepts short lowercase slugs and rejects everything else", () => {
    expect(normalizeSignupSource("ctbirds")).toBe("ctbirds");
    expect(normalizeSignupSource(" FB-CT-Birds ")).toBe("fb-ct-birds");
    expect(normalizeSignupSource("has spaces")).toBeNull();
    expect(normalizeSignupSource("a".repeat(41))).toBeNull();
    expect(normalizeSignupSource("<script>")).toBeNull();
    expect(normalizeSignupSource("")).toBeNull();
  });
});

describe("recordSignupEvent", () => {
  it("stores only a truncated hash, never the address", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const blobPut = vi.fn(async (path) => ({ url: `https://blob.test/${path}` }));

    await recordSignupEvent({
      type: "confirmed",
      src: "ctbirds",
      regionIds: ["northeast"],
      email: "Birder@Example.com"
    }, { blobPut, now: new Date("2026-08-21T15:00:00.000Z") });

    const [path, body] = blobPut.mock.calls[0];
    expect(path).toBe(`events/signup/2026-08-21-${hashSignupEmail("birder@example.com")}-confirmed.json`);
    expect(body).not.toContain("example.com");
    expect(JSON.parse(body)).toMatchObject({ src: "ctbirds", regionIds: ["northeast"] });
  });

  it("falls back to the app source and skips Blob without a token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const blobPut = vi.fn();

    const result = await recordSignupEvent({
      type: "confirmed",
      src: "not a slug!!",
      regionIds: ["west"],
      email: "birder@example.com"
    }, { blobPut });

    expect(result).toBeNull();
    expect(blobPut).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ src: "app" });
  });
});
