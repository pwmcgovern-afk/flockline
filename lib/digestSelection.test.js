import { describe, expect, it } from "vitest";
import {
  digestWeek,
  assessDigestReport,
  selectDigestReports,
} from "./digestSelection.js";
import { factualEditorialPayload } from "../shared/findingCopy.js";
import { renderDigestHtml, renderDigestText } from "./digestEmail.js";
import registry from "../shared/digestSelectionRules.json" with { type: "json" };
const week = { start: "2026-11-09", end: "2026-11-15" };
const row = (name, state = "US-NY", extra = {}) => ({
  comName: name,
  speciesCode: name.toLowerCase().replace(/\W/g, ""),
  regionCode: state,
  obsDt: "2026-11-14 08:00",
  subId: "S123456789",
  obsValid: true,
  obsReviewed: false,
  ...extra,
});
describe("documented digest selection", () => {
  it.each([
    "Common Grackle",
    "Ruby-crowned Kinglet",
    "Eastern Towhee",
    "Red-throated Loon",
    "Ruby-throated Hummingbird",
    "Sedge Wren",
    "Red-breasted Nuthatch",
    "Red Crossbill",
    "Sora",
  ])("does not promote a routine flag without a rule: %s", (name) => {
    expect(assessDigestReport(row(name), week).decision).toBe("exclude");
  });
  it.each([
    "Garganey",
    "Cinnamon Teal",
    "Western Grebe",
    "Purple Gallinule",
    "Yellow Rail",
    "Northern Lapwing",
    "Ruff",
    "Little Stint",
    "Black Rail",
    "Varied Thrush",
    "Northern Wheatear",
    "Brambling",
    "Eurasian Collared-Dove",
    "Western Flycatcher",
    "Taiga Bean-Goose",
    "Snowy Plover",
    "Loggerhead Shrike",
    "Glaucous-winged Gull",
    "LeConte's Sparrow",
  ])("retains an accepted NY review-list report: %s", (name) => {
    expect(assessDigestReport(row(name), week).decision).toBe("eligible");
  });
  it.each([
    "Barnacle Goose",
    "Common Eider",
    "Spruce Grouse",
    "Bicknell's Thrush",
    "Brant",
    "Redpoll",
    "Yellow-rumped Warbler",
    "Western Sandpiper",
  ])("does not broaden a conditional NY rule: %s", (name) => {
    expect(assessDigestReport(row(name), week).decision).toBe("exclude");
  });
  it("evaluates locality before species collapse and preserves unreviewed candidates", () => {
    const rows = [
      row("Varied Thrush", "US-WA", {
        subId: "S123456780",
        obsDt: "2026-11-15",
      }),
      row("Varied Thrush"),
      row("Garganey", "US-NY", { obsValid: false }),
    ];
    const result = selectDigestReports(rows, {
      now: new Date("2026-11-16T15:00:00Z"),
      regions: ["US-NY", "US-WA"],
    });
    expect(result.selected.map((x) => x.subId)).toEqual(["S123456789"]);
    expect(result.selection.ledger.map((x) => x.decision)).toEqual([
      "exclude",
      "selected",
      "hold",
    ]);
    expect(result.selection.uncoveredStates).toEqual(["US-WA"]);
  });
  it.each([
    ["2026-06-30", "eligible"],
    ["2026-07-01", "exclude"],
    ["2026-01-31", "exclude"],
    ["2026-02-01", "eligible"],
  ])("honors the NY seasonal edge %s", (date, decision) => {
    expect(
      assessDigestReport(row("Baird's Sandpiper", "US-NY", { obsDt: date }), {
        start: date,
        end: date,
      }).decision,
    ).toBe(decision);
  });
  it.each([
    ["2026-07-01", "exclude"],
    ["2026-01-15", "eligible"],
  ])("uses explicit Vermont seasonal rules %s", (date, decision) => {
    expect(
      assessDigestReport(row("Scarlet Tanager", "US-VT", { obsDt: date }), {
        start: date,
        end: date,
      }).decision,
    ).toBe(decision);
  });
  it.each(["2026-01-01", "2026-06-01", "2026-12-31"])(
    "never makes year-round Vermont cardinals seasonal rarities: %s",
    (date) => {
      expect(
        assessDigestReport(row("Northern Cardinal", "US-VT", { obsDt: date }), {
          start: date,
          end: date,
        }).decision,
      ).toBe("exclude");
    },
  );
  it("excludes rejected reports and current Monday, including DST calendar boundaries", () => {
    expect(
      assessDigestReport(
        row("Garganey", "US-NY", { obsValid: false, obsReviewed: true }),
        week,
      ).reason,
    ).toBe("not_accepted");
    expect(
      assessDigestReport(
        row("Garganey", "US-NY", { obsDt: "2026-11-16" }),
        week,
      ).reason,
    ).toBe("outside_week");
    expect(digestWeek(new Date("2026-11-02T15:00:00Z"))).toEqual({
      start: "2026-10-26",
      end: "2026-11-01",
    });
  });
  it("preserves supported explanations across email and archive formatting, with source links", () => {
    const { selected, selection } = selectDigestReports([row("Garganey")], {
      now: new Date("2026-11-16T15:00:00Z"),
    });
    const payload = factualEditorialPayload({
      scopeId: "northeast",
      scopeLabel: "Northeast",
      generatedAt: "2026-11-16T15:00:00Z",
      selection,
      findings: selected,
    });
    expect(factualEditorialPayload(payload, { correctLegacy: true })).toEqual(
      payload,
    );
    expect(renderDigestHtml(payload)).toContain("Why it qualifies");
    expect(renderDigestHtml(payload)).toContain("week ending Nov 15, 2026");
    expect(renderDigestText(payload)).toContain("week ending Nov 15, 2026");
    expect(renderDigestText(payload)).toContain(
      "https://nybirds.org/NYSARC/NYSARClist.htm",
    );
    expect(payload.findings[0].detail).toContain(
      "New York State Avian Records Committee",
    );
    expect(
      factualEditorialPayload({ findings: [row("Common Grackle")] })
        .editorialPolicy,
    ).toBe("source-facts-v1");
  });
  it("omits multi-interval Vermont rules and Texas presumptive records", () => {
    const date = "2026-05-15";
    expect(
      assessDigestReport(row("Brant", "US-VT", { obsDt: date }), {
        start: date,
        end: date,
      }).decision,
    ).toBe("exclude");
    expect(
      registry.rules.filter((r) => r.state === "US-TX").map((r) => r.name),
    ).not.toContain("Murre species");
    expect(
      registry.rules.filter((r) => r.state === "US-TX").map((r) => r.name),
    ).not.toContain("Razorbill");
    expect(registry.rules.map((r) => r.name)).not.toContain("Collared-Dove");
  });
  it("has unique rule identities, valid source references, and no blanket subspecies rules", () => {
    expect(new Set(registry.rules.map((r) => r.id)).size).toBe(
      registry.rules.length,
    );
    for (const rule of registry.rules) {
      expect(
        registry.sources.some(
          (s) => s.id === rule.sourceId && s.state === rule.state,
        ),
      ).toBe(true);
      expect(rule.name).not.toMatch(/[“”"/]/);
    }
  });
});
