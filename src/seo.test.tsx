import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "./seo-entry";

const template = readFileSync("index.html", "utf8");
const issue = {
  scopeId: "northeast",
  scopeLabel: "Northeast",
  generatedAt: "2026-09-07T14:00:00Z",
  summary: "Six notable birds across the Northeast.",
  findings: [
    {
      title: "A rare osprey report",
      detail: "A saved report, with its actual detail.",
      speciesCode: "osprey",
    },
  ],
};

describe("search-visible pages", () => {
  it("serves the saved article, matching metadata, canonical and structured data without JavaScript", () => {
    const html = renderPage(
      template,
      new URL(
        "https://preview.vercel.app/roundup/northeast/2026-09-07?src=reddit",
      ),
      { roundup: issue },
    );
    expect(html).toContain("A saved report, with its actual detail.");
    expect(html).not.toContain("Loading this issue");
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain(
      'href="https://flockline.app/roundup/northeast/2026-09-07"',
    );
    expect(html).not.toContain("preview.vercel.app");
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"datePublished":"2026-09-07T14:00:00Z"');
  });
  it("renders index links, newsletter and methodology as actual HTML", () => {
    const html = renderPage(
      template,
      new URL("https://flockline.app/roundup"),
      { index: { issues: [{ scopeId: "northeast", date: "2026-09-07" }] } },
    );
    expect(html).toContain('href="/roundup/northeast/2026-09-07"');
    expect(
      renderPage(
        template,
        new URL("https://flockline.app/newsletter?region=west"),
      ),
    ).toContain("What's inside".replace("'", "&#x27;"));
    expect(
      renderPage(template, new URL("https://flockline.app/methodology")),
    ).toContain("Where the data comes from");
  });
  it("keeps map previews descriptive while consolidating filtered maps", () => {
    const html = renderPage(
      template,
      new URL("https://flockline.app/?bird=osprey&region=northeast"),
    );
    expect(html).toContain("Osprey · Northeast · Flockline");
    expect(html).toContain('rel="canonical" href="https://flockline.app/"');
  });
  it("does not index missing pages or temporary errors", () => {
    for (const status of [404, 503]) {
      const html = renderPage(
        template,
        new URL("https://flockline.app/roundup/northeast/2020-01-01"),
        {},
        status,
      );
      expect(html).toContain('name="robots" content="noindex"');
      expect(html).not.toContain('"@type":"Article"');
    }
  });
  it("escapes saved text in both HTML and JSON without replacement-token corruption", () => {
    const html = renderPage(
      template,
      new URL("https://flockline.app/roundup/northeast/2026-09-07"),
      {
        roundup: { ...issue, summary: "</script><script>alert(1)</script> $&" },
      },
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("$&amp;");
  });
});
