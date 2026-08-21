// No import attribute: Vercel bundles middleware with esbuild, which reads
// JSON imports natively and rejects the `with { type: "json" }` syntax.
import speciesCatalog from "./speciesCatalog.json";
import { US_REGION_PRESETS, US_STATES } from "./usGeography.js";

// Pure metadata derivation, kept out of middleware.js so it can be unit tested
// without standing up a request.
const SPECIES_NAMES = new Map(
  speciesCatalog.map((species) => [species.speciesCode, species.comName])
);
const REGION_NAMES = new Map(US_REGION_PRESETS.map((region) => [region.id, region.name]));
const STATE_NAMES = new Map(US_STATES.map((state) => [state.code, state.name]));

const SITE = "Flockline";
const DEFAULT_TITLE = "Flockline · Live U.S. Bird Sightings";
const DEFAULT_DESCRIPTION =
  "Follow recent bird movement anywhere in the United States with live eBird sightings, regional filters, an interactive timeline, and field-ready insights.";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPageMeta(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";

  if (path === "/newsletter") {
    return {
      title: `Weekly bird insights by email · ${SITE}`,
      description:
        "Six verified notable birds in your region, from live eBird reports, every Monday at 10 AM ET. Free from Flockline."
    };
  }

  if (path === "/roundup") {
    return {
      title: `Weekly birding roundups · ${SITE}`,
      description:
        "Flockline's archive of weekly notable-bird roundups across the United States, built from verified eBird reports."
    };
  }

  const issue = path.match(/^\/roundup\/([a-z-]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/);
  if (issue) {
    const regionName = REGION_NAMES.get(issue[1]);
    const scopeLabel = !regionName || issue[1] === "nationwide" ? "U.S." : regionName;
    const dated = issue[2] ? ` · week ending ${issue[2]}` : "";
    return {
      title: `${scopeLabel} birding roundup${dated} · ${SITE}`,
      description: `The most notable verified bird sightings across the ${scopeLabel === "U.S." ? "United States" : scopeLabel} this week, from live eBird reports.`
    };
  }

  return null;
}

function describeScope(params) {
  const preset = params.get("region");
  if (preset && REGION_NAMES.has(preset)) {
    const name = REGION_NAMES.get(preset);
    // "in Northeast" and "across Nationwide" both read as machine output.
    // These are the only five presets, so name them the way a person would.
    if (preset === "nationwide") {
      return { label: "the U.S.", phrase: "the United States", isDefault: true };
    }
    return { label: name, phrase: `the ${name}` };
  }
  const states = (params.get("states") || "")
    .split(",")
    .map((code) => STATE_NAMES.get(code.trim().toUpperCase()))
    .filter(Boolean);
  if (!states.length) {
    return null;
  }
  // Three names is about where a preview card stops being readable.
  if (states.length <= 3) {
    const joined = states.join(", ");
    return { label: joined, phrase: joined };
  }
  return { label: `${states.length} states`, phrase: `${states.length} states` };
}

export function buildMeta(url) {
  // Standalone pages carry their identity in the path, not the query.
  const pageMeta = buildPageMeta(url.pathname);
  if (pageMeta) {
    return pageMeta;
  }

  const params = url.searchParams;
  const bird = params.get("bird");
  const species = bird && bird !== "browse" ? SPECIES_NAMES.get(bird) : null;
  const scope = describeScope(params);
  const days = Number(params.get("days"));
  const window =
    Number.isFinite(days) && days > 0
      ? `the past ${days} ${days === 1 ? "day" : "days"}`
      : "the past week";

  if (!species) {
    return {
      title: scope ? `Bird sightings across ${scope.label} · ${SITE}` : DEFAULT_TITLE,
      description: scope
        ? `Live eBird reports across ${scope.phrase}, mapped by how recently each bird was seen.`
        : DEFAULT_DESCRIPTION
    };
  }

  return {
    // Nationwide is the default scope, so naming it in the title is noise.
    title: `${species}${scope && !scope.isDefault ? ` · ${scope.label}` : ""} · ${SITE}`,
    description: `Where ${species} has been reported in ${scope ? scope.phrase : "the United States"} over ${window}, from live eBird checklists.`
  };
}
