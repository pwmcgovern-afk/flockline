import { describe, expect, it } from "vitest";
import { parseArchivePath } from "./archivePath";

describe("archive navigation", () => {
  it("recognizes the index, regional latest issue, and dated issue", () => {
    expect(parseArchivePath("/roundup/")).toEqual({ valid: true, scopeId: null, date: null });
    expect(parseArchivePath("/roundup/west")).toEqual({ valid: true, scopeId: "west", date: null });
    expect(parseArchivePath("/roundup/west/2024-02-29")).toEqual({ valid: true, scopeId: "west", date: "2024-02-29" });
  });
  it.each([
    "/roundup/atlantis", "/roundup/west/garbage", "/roundup/west/2026-02-29",
    "/roundup/west/2026-02-30", "/roundup/west/2026-13-01", "/roundup/west/2026-08-24/extra"
  ])("rejects %s instead of substituting a different edition", (path) => {
    expect(parseArchivePath(path).valid).toBe(false);
  });
});
