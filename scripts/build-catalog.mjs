// Regenerates shared/speciesCatalog.json from eBird.
//
// Pulls the United States species list via product/spplist, joins it against
// the eBird taxonomy, keeps only true species (drops "sp."/slash/hybrid/
// domestic noise), and buckets each into a Flockline browse group. Run once
// after eBird changes or to refresh:
//   node scripts/build-catalog.mjs
//
// EBIRD_API_KEY is optional: with a key, the script uses product/spplist;
// otherwise it extracts codes from eBird's public all-time U.S. bird-list page.
// The output is committed, so the app never calls eBird for its browse library.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://api.ebird.org/v2";
const KEY = process.env.EBIRD_API_KEY;
const COUNTRY_REGION = "US";

const headers = KEY ? { "x-ebirdapitoken": KEY } : {};

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${url}\n${(await res.text()).slice(0, 160)}`);
  }
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${url}\n${(await res.text()).slice(0, 160)}`);
  }
  return res.text();
}

async function getUnitedStatesCodes() {
  if (KEY) {
    try {
      return new Set(await getJson(`${API}/product/spplist/${COUNTRY_REGION}`));
    } catch (error) {
      console.warn(`Species-list API unavailable (${error.message.split("\n")[0]}), using the public bird list.`);
    }
  }

  const html = await getText("https://ebird.org/region/US/bird-list?yr=all");
  const codes = new Set(
    [...html.matchAll(/["']?speciesCode["']?\s*:\s*["']([^"']+)["']/g)].map((match) => match[1])
  );
  if (codes.size < 1000) {
    throw new Error(`Public U.S. bird list returned only ${codes.size} taxon codes.`);
  }
  return codes;
}

// Bucket an eBird taxon into one of Flockline's browse groups, mostly by the
// family common name (stable across the taxonomy), with a few order fallbacks.
function familyToGroup(taxon) {
  const fam = (taxon.familyComName || "").toLowerCase();
  const order = (taxon.order || "").toLowerCase();
  const has = (...needles) => needles.some((n) => fam.includes(n));

  if (has("waterfowl", "ducks")) return "Waterfowl";
  if (has("pheasants", "grouse", "new world quail") || order === "galliformes") return "Upland";
  if (has("grebes", "loons", "cormorants", "pelicans", "gannets", "boobies", "storks", "frigatebirds", "shearwaters", "petrels", "storm-petrels", "tropicbirds", "albatrosses", "fulmars")) return "Waterbirds";
  if (has("herons", "bitterns", "ibises", "spoonbills", "rails", "gallinules", "cranes", "limpkin")) return "Waders";
  if (has("gulls", "terns", "skimmers", "skuas", "auks", "puffins")) return "Coastal";
  if (has("plovers", "sandpipers", "oystercatchers", "stilts", "avocets", "jacanas", "lapwings", "woodcocks", "snipes", "turnstones")) return "Shorebirds";
  if (has("osprey", "hawks", "eagles", "kites", "vultures") || order === "accipitriformes" || order === "cathartiformes") return "Raptors";
  if (has("falcons", "caracaras")) return "Raptors";
  if (has("owls")) return "Owls";
  if (has("woodpeckers")) return "Woodpeckers";
  if (has("tyrant flycatchers")) return "Flycatchers";
  if (has("vireos")) return "Vireos";
  if (has("crows", "jays", "magpies")) return "Corvids";
  if (has("swifts", "swallows", "nightjars", "martins")) return "Aerial";
  if (has("new world warblers")) return "Warblers";
  if (has("new world sparrows", "towhees")) return "Sparrows";
  if (has("cardinals", "grosbeaks", "tanagers", "buntings")) return "Grosbeaks";
  if (has("blackbirds", "orioles", "troupials", "meadowlarks")) return "Blackbirds";
  // Songbirds, dooryard birds, doves, and everything else common in the yard.
  if (
    has(
      "chickadees", "tits", "nuthatches", "wrens", "kinglets", "gnatcatchers",
      "thrushes", "mockingbirds", "thrashers", "starlings", "waxwings", "larks",
      "pipits", "old world sparrows", "finches", "euphonias", "creepers",
      "bushtits", "verdins", "pigeons", "doves", "hummingbirds"
    )
  ) {
    return "Backyard";
  }
  return "Other";
}

async function main() {
  console.log("Fetching taxonomy…");
  const taxonomy = await getJson(`${API}/ref/taxonomy/ebird?fmt=json&locale=en`);
  const byCode = new Map(taxonomy.map((t) => [t.speciesCode, t]));

  console.log("Fetching species list for the United States…");
  const codes = await getUnitedStatesCodes();

  const catalog = [];
  let dropped = 0;
  for (const code of codes) {
    const taxon = byCode.get(code);
    if (!taxon) continue;
    if (taxon.category !== "species") {
      dropped += 1;
      continue;
    }
    catalog.push({
      speciesCode: taxon.speciesCode,
      comName: taxon.comName,
      sciName: taxon.sciName,
      group: familyToGroup(taxon),
    });
  }

  catalog.sort((a, b) => a.group.localeCompare(b.group) || a.comName.localeCompare(b.comName));

  const byGroup = catalog.reduce((acc, s) => ((acc[s.group] = (acc[s.group] || 0) + 1), acc), {});
  console.log(`\nUS codes: ${codes.size} | species kept: ${catalog.length} | non-species dropped: ${dropped}`);
  console.log("By group:", byGroup);

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "speciesCatalog.json");
  writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`\nWrote ${catalog.length} species → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
