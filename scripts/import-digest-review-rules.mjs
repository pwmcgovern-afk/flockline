import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { load } = require("cheerio");
// Read source captures from the directory supplied as the first argument.
const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error("Supply the source capture directory");
const rules = [];
const sources = [];
const normalize = (s) => s.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
async function source(state, file, url, authority) {
  const raw = await readFile(sourceDirectory + "/" + file);
  const src = {
    id: state,
    state: "US-" + state,
    url,
    authority,
    retrieved: "2026-11-16",
    sha256: createHash("sha256").update(raw).digest("hex"),
    scope:
      "Selected unambiguous rules; not an exhaustive state rarity classification",
  };
  sources.push(src);
  return load(raw.toString());
}
function add(state, name, extra = {}) {
  name = normalize(name);
  if (!name || /[“”"/()*\d]/.test(name) || name.length > 65) return;
  rules.push({
    id: state + "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    state: "US-" + state,
    name,
    sourceId: state,
    kind: "state-review",
    ...extra,
  });
}
let $ = await source(
  "CT",
  "CT.html",
  "https://www.ctbirding.org/arcc/arcc-review-list/",
  "Avian Records Committee of Connecticut",
);
const ct = $(".entry-content h3").first().next(".wp-block-columns");
ct.find("br").replaceWith("\n");
ct.find("p").each((i, e) =>
  $(e)
    .text()
    .split("\n")
    .forEach((n) => add("CT", n)),
);
$ = await source(
  "MA",
  "MA.html",
  "https://maavianrecords.com/review-list/",
  "Massachusetts Avian Records Committee",
);
$("tr").each((i, e) => {
  const td = $(e).find("td");
  if (td.length === 2 && /^[A-Z][a-z]+ [a-z]+$/.test(td.eq(1).text().trim()))
    add(
      "MA",
      td
        .first()
        .text()
        .replace(/\(eB\)|\*\*/g, ""),
    );
});
$ = await source(
  "ME",
  "ME2.html",
  "https://sites.google.com/site/mainebirdrecordscommittee/about/review-list",
  "Maine Bird Records Committee",
);
$("p").each((i, e) => {
  const t = normalize($(e).text());
  const m = t.match(/^([^()]+) \([A-Z][a-z]+ [a-z]+\)$/);
  if (m) add("ME", m[1]);
});
$ = await source(
  "NY",
  "NY.html",
  "https://nybirds.org/NYSARC/NYSARClist.htm",
  "New York State Avian Records Committee",
);
$("s,strike,del").remove();
// Source newlines are formatting, whereas <br> and paragraphs delimit records.
$("br").replaceWith("|||");
$("p").append("|||");
for (const line of $("body").text().split("|||")) {
  const t = normalize(line);
  if (/REMOVED|REPLACED|LUMPED/.test(t)) continue;
  const m = t.match(
    /^([A-Za-z][A-Za-z '\-]+?)\s+[A-Z](?:[a-z]+\.?|\.)\s*[a-z]+\s+\(N\)(?:\*|\s|$)/,
  );
  if (m) add("NY", m[1]);
}
// Explicit seasonal review windows, unlike geographic or taxon conditions needing extra evidence.
add("NY", "Baird's Sandpiper", {
  kind: "seasonal-review",
  start: "02-01",
  end: "06-30",
});
add("NY", "Western Sandpiper", {
  kind: "seasonal-review",
  start: "02-01",
  end: "05-31",
});
$ = await source(
  "PA",
  "PA.html",
  "https://pabirds.org/porc-review-list/",
  "Pennsylvania Ornithological Records Committee",
);
$("#ReviewA")
  .nextUntil("#ReviewB")
  .find("li")
  .add($("#ReviewA").nextUntil("#ReviewB").filter("p"))
  .each((i, e) => {
    const t = normalize($(e).text());
    const m = t.match(
      /^([^()]+)\s*\([A-Z][a-z]+ [a-z]+\)\s*(?:Casual|Accidental)\./,
    );
    if (m) add("PA", m[1]);
  });
$ = await source(
  "MI",
  "MI.html",
  "https://mibirdrecords.com/review-list/",
  "Michigan Bird Records Committee",
);
for (const line of (await readFile(sourceDirectory + "/MI.txt", "utf8")).split(
  "\n",
)) {
  const m = normalize(line).match(
    /^([^,]+), [A-Z][a-z]+ [a-z]+ \[(?:Casual|Accidental)\]$/,
  );
  if (m) add("MI", m[1]);
}
$ = await source(
  "TX",
  "TX.html",
  "https://www.texasbirdrecordscommittee.org/texas-review-list/texas-review-list-species",
  "Texas Bird Records Committee",
);
let inTexasRarities = false;
$("h2,p").each((i, e) => {
  const t = normalize($(e).text());
  if (t === "Review List A -- Rarities") {
    inTexasRarities = true;
    return;
  }
  if (t === "Review List B" || t === "Presumptive List") {
    inTexasRarities = false;
    return;
  }
  if (!inTexasRarities) return;
  const m = t.match(/^([A-Za-z][A-Za-z '\-]+) \(\d+\*?\)$/);
  if (m) add("TX", m[1]);
});
$ = await source(
  "CA",
  "CA.html",
  "https://californiabirds.org/review.asp",
  "California Bird Records Committee",
);
$("br").replaceWith("\n");
for (const line of $("body").text().split("\n")) {
  const m = normalize(line).match(
    /^([A-Za-z][A-Za-z '\-]+) [A-Z][a-z]+ [a-z]+(?: - [A-Z]*)?$/,
  );
  if (m) add("CA", m[1]);
}
await source(
  "NH",
  "NH.pdf",
  "https://nhbirdrecords.org/NHRBC/wp-content/uploads/2023/11/NH-state-review-list-combined-Feb-2023.pdf",
  "New Hampshire Rare Birds Committee",
);
for (const line of (
  await readFile(sourceDirectory + "/NHpdf.txt", "utf8")
).split("\n")) {
  const m = line.match(
    /^([A-Za-z][A-Za-z '\-]+?)\s{2,}[A-Z][a-z]+ [a-z]+\s+All records\b/,
  );
  if (m) add("NH", m[1]);
}
await source(
  "VT",
  "VT.pdf",
  "https://vtecostudies.nyc3.digitaloceanspaces.com/wp-content/uploads/2025/09/08163834/VTStateList_TM20250826.pdf",
  "Vermont Bird Records Committee",
);
for (const line of (
  await readFile(sourceDirectory + "/VTpdf.txt", "utf8")
).split("\n")) {
  const m = line.match(
    /^\s*\d+\s+(.+?)\s{2,}[A-Z][a-z]+ [a-z]+\s+(?:\*\s+)?V\s*$/,
  );
  if (m) add("VT", m[1]);
}
const unique = [...new Map(rules.map((r) => [r.id, r])).values()];
await writeFile(
  "shared/digestSelectionRules.json",
  JSON.stringify(
    { version: "review-lists-2026-11-16", sources, rules: unique },
    null,
    2,
  ) + "\n",
);
console.log(
  Object.fromEntries(
    sources.map((s) => [
      s.id,
      unique.filter((r) => r.sourceId === s.id).length,
    ]),
  ),
);
