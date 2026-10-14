import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatReply from "./ChatReply";
import type { ChatChecklistSource } from "./types";

const source: ChatChecklistSource = {
  subId: "S123456789", speciesCode: "osprey", comName: "Osprey", locName: "Riverside Park",
  obsDt: "2026-10-14 09:00", reviewStatus: "Not reviewed by eBird",
};
const render = (text: string, sources = [source]) => renderToStaticMarkup(<ChatReply text={text} sources={sources} />);

describe("Ask source presentation", () => {
  it("links source-backed canonical URLs, bare IDs, and markdown links without losing paragraphs or bullets", () => {
    const html = render("Report: https://ebird.org/checklist/S123456789.\n- S123456789\n- [View checklist](https://ebird.org/checklist/S123456789)");
    expect(html.match(/href="https:\/\/ebird.org\/checklist\/S123456789"/g)).toHaveLength(4);
    expect(html).toContain("</a>.</p><ul>");
    expect(html).toContain(">View checklist</a>");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Source reports (1)");
    expect(html).toContain("2026-10-14 09:00 · Not reviewed by eBird");
  });

  it("keeps invented IDs, lookalike domains, insecure URLs, and script markup inert", () => {
    const html = render('https://ebird.org/checklist/S999999999 https://ebird.org.evil.test/checklist/S123456789 http://ebird.org/checklist/S123456789 [Fake](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html.match(/href=/g)).toHaveLength(1); // The structured evidence disclosure only.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("https://ebird.org/checklist/S999999999");
  });

  it("does not turn user text or an answer without evidence into trusted citations", () => {
    const html = render("S123456789 https://ebird.org/checklist/S123456789", []);
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<details");
  });

  it("constructs source URLs from valid IDs and escapes source labels", () => {
    const html = render("Report", [
      { ...source, comName: "<script>alert(1)</script>" },
      { ...source, subId: "S123456789?redirect=evil.test", speciesCode: "baleag" },
    ]);
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("redirect=");
  });
});
