import { afterEach, describe, expect, it, vi } from "vitest";
import middleware from "./middleware.js";

const shell = `<!doctype html>
<html>
  <head>
    <title>Flockline</title>
    <meta name="description" content="old">
    <meta property="og:title" content="old">
    <meta property="og:description" content="old">
    <meta property="og:url" content="old">
    <meta name="twitter:title" content="old">
    <meta name="twitter:description" content="old">
  </head>
</html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("share metadata middleware", () => {
  it("forwards preview authentication when fetching the static shell", async () => {
    const fetchShell = vi.fn(async () => new Response(shell, { status: 200 }));
    vi.stubGlobal("fetch", fetchShell);

    const request = new Request(
      "https://flockline-feature.example.vercel.app/?bird=osprey&region=northeast&days=7",
      {
        headers: {
          cookie: "preview-session=test-session",
          "x-vercel-protection-bypass": "test-bypass"
        }
      }
    );

    const response = await middleware(request);
    const [shellUrl, shellInit] = fetchShell.mock.calls[0];
    const headers = new Headers(shellInit.headers);

    expect(shellUrl.href).toBe("https://flockline-feature.example.vercel.app/index.html");
    expect(headers.get("cookie")).toBe("preview-session=test-session");
    expect(headers.get("x-vercel-protection-bypass")).toBe("test-bypass");
    expect(headers.get("x-flockline-shell")).toBe("1");
    await expect(response.text()).resolves.toContain("Osprey · Northeast · Flockline");
  });
});
