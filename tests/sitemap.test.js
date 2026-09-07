import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/roundupArchive.js", () => ({
  archiveConfigured: vi.fn(),
  listArchivedRoundups: vi.fn(),
}));
import {
  archiveConfigured,
  listArchivedRoundups,
} from "../lib/roundupArchive.js";
import handler from "../api/sitemap.js";

function response() {
  return {
    headers: {},
    code: 0,
    body: "",
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.code = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  archiveConfigured.mockReturnValue(true);
});
describe("sitemap delivery", () => {
  it("lists published canonical pages and discovers newly archived issues", async () => {
    listArchivedRoundups.mockResolvedValue([
      {
        scopeId: "northeast",
        date: "2026-09-07",
        url: "https://storage.example/private-implementation.json",
      },
    ]);
    const res = response();
    await handler({ method: "GET" }, res);
    expect(res.code).toBe(200);
    expect(res.headers["Content-Type"]).toContain("application/xml");
    expect(res.body).toContain(
      "https://flockline.app/roundup/northeast/2026-09-07",
    );
    expect(res.body.match(/<loc>/g)).toHaveLength(5);
    expect(res.body).not.toContain("storage.example");
    expect(res.body).not.toContain("<lastmod>");
  });
  it("returns retryable failure instead of replacing the sitemap with an empty one", async () => {
    archiveConfigured.mockReturnValue(false);
    const res = response();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await handler({ method: "GET" }, res);
    expect(res.code).toBe(503);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["Retry-After"]).toBe("60");
    expect(listArchivedRoundups).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("does not accept write requests", async () => {
    const res = response();
    await handler({ method: "POST" }, res);
    expect(res.code).toBe(405);
    expect(listArchivedRoundups).not.toHaveBeenCalled();
  });
});
