// Rebuild after the Northeast import scripts. Read only preserved source captures.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { load } from "cheerio";
const root = process.argv[2];
if (!root) throw new Error("Supply the national source capture directory");
const registry = JSON.parse(
  await readFile("shared/digestSelectionRules.json", "utf8"),
);
const catalog = JSON.parse(
  await readFile("shared/speciesCatalog.json", "utf8"),
);
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const known = new Map(
  [...catalog.map((x) => x.comName), ...registry.rules.map((x) => x.name)].map(
    (x) => [norm(x).toLowerCase(), norm(x)],
  ),
);
const aliases = {
  "common blackhawk": "Common Black Hawk",
  "blue rock-thrush": "Blue Rock-Thrush",
  "black-vent. shearwater": "Black-vented Shearwater",
  "yellow-crwnd. night heron": "Yellow-crowned Night-Heron",
  "yellow--green vireo": "Yellow-green Vireo",
  "black-thr. green warbler": "Black-throated Green Warbler",
  "black-bellied whistling duck": "Black-bellied Whistling-Duck",
  "calliope humingbird": "Calliope Hummingbird",
  "protonotary warbler": "Prothonotary Warbler",
  "vermilion flyatcher": "Vermilion Flycatcher",
  "vermillion flycatcher": "Vermilion Flycatcher",
  "townsend's solitare": "Townsend's Solitaire",
  "heerman's gull": "Heermann's Gull",
  "greater prairie chicken": "Greater Prairie-Chicken",
  "lesser prairie chicken": "Lesser Prairie-Chicken",
  "common ground dove": "Common Ground Dove",
  "ruddy ground dove": "Ruddy Ground Dove",
  "barn owl": "American Barn Owl",
  "northern goshawk": "American Goshawk",
  "gray jay": "Canada Jay",
  "mew gull": "Mew Gull",
};
const sourceUrls = {};
for (const log of [
  "downloads",
  "downloads2",
  "downloads3",
  "downloads5",
  "downloads6",
  "downloads7",
  "downloads8",
]) {
  for (const line of (await readFile(`${root}/${log}.jsonl`, "utf8"))
    .trim()
    .split("\n")) {
    const x = JSON.parse(line);
    if (x.status === 200 && !x.url.includes("meadowlark"))
      sourceUrls[x.state] = x.url;
  }
}
const authorities = {
  AL: "Alabama Bird Records Committee",
  AK: "Alaska Bird Records Committee / University of Alaska Museum",
  AZ: "Arizona Bird Committee",
  AR: "Arkansas Bird Records Committee",
  CO: "Colorado Bird Records Committee",
  DE: "Delaware Bird Records Committee",
  FL: "Florida Ornithological Society Records Committee",
  GA: "Georgia Ornithological Society Checklist and Records Committee",
  HI: "Hawaii Bird Records Committee",
  ID: "Idaho Bird Records Committee",
  IL: "Illinois Ornithological Records Committee",
  IN: "Indiana Bird Records Committee",
  IA: "Iowa Records Committee",
  KS: "Kansas Bird Records Committee",
  KY: "Kentucky Bird Records Committee",
  LA: "Louisiana Bird Records Committee",
  MD: "Maryland/District of Columbia Records Committee",
  DC: "Maryland/District of Columbia Records Committee",
  MN: "Minnesota Ornithologists' Union Records Committee",
  MS: "Mississippi Bird Records Committee",
  MO: "Missouri Bird Records Committee",
  MT: "Montana Bird Records Committee",
  NE: "Nebraska Ornithologists' Union Records Committee",
  NV: "Nevada Bird Records Committee",
  NJ: "New Jersey Bird Records Committee",
  NM: "New Mexico Bird Records Committee",
  NC: "North Carolina Bird Records Committee",
  ND: "North Dakota Records Committee",
  OH: "Ohio Bird Records Committee",
  OK: "Oklahoma Bird Records Committee",
  OR: "Oregon Bird Records Committee",
  RI: "Rhode Island Avian Records Committee",
  SC: "South Carolina Bird Records Committee",
  SD: "South Dakota Rare Bird Records Committee",
  TN: "Tennessee Bird Records Committee",
  UT: "Utah Bird Records Committee",
  VA: "Virginia Avian Records Committee",
  WA: "Washington Bird Records Committee",
  WV: "West Virginia Bird Records Committee",
  WI: "Wisconsin Society for Ornithology Records Committee",
  WY: "Wyoming Bird Records Committee",
};
const omitted = [];
function add(state, name, condition = "", extra = {}) {
  name = norm(name).replace(/^\[|\]$/g, "");
  condition = norm(condition);
  if (
    !name ||
    /^(?:species|new to state|common name|scientific|family|order|review)/i.test(
      name,
    )
  )
    return;
  if (
    /Labrador Duck|Passenger Pigeon|Carolina Parakeet|Great Auk|Eskimo Curlew|Ivory-billed Woodpecker|Bachman's Warbler/.test(
      name,
    )
  )
    return;
  if (/[“”"/]/.test(name)) {
    omitted.push({ state, name, condition, reason: "taxon_or_species_group" });
    return;
  }
  if (!/^[A-Za-z][A-Za-z '\-]+$/.test(name) || name.length > 65) return;
  const canonical =
    aliases[name.toLowerCase()] || known.get(name.toLowerCase()) || name;
  const id = state + "-" + canonical.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (added.some((r) => r.id === id)) return;
  if (
    /Bean Goose$|Mew Gull|Hoary Redpoll|Common Redpoll|Lesser Sand-Plover|Audubon's Shearwater|Cordilleran Flycatcher|Pacific-slope Flycatcher|House Wren$|Warbling Vireo$/.test(
      canonical,
    )
  )
    condition = condition || "Taxonomy reconciliation required";
  added.push({
    id,
    state: "US-" + state,
    name: canonical,
    sourceId: state,
    kind: "state-review",
    ...(condition ? { condition, requiresReview: true } : {}),
    ...extra,
  });
}
const added = [];
const text = async (st) => readFile(`${root}/${st}.txt`, "utf8");
const html = async (st) => load(await readFile(`${root}/${st}.html`, "utf8"));
const lines = async (st) =>
  (await text(st)).split("\n").map(norm).filter(Boolean);
function listLine(st, line) {
  const direct = aliases[norm(line).toLowerCase()];
  if (direct) {
    add(st, direct);
    return;
  }
  const m = norm(line).match(
    /^([A-Za-z][A-Za-z '\-]+?)(\s*\(.*|,\s*(?:document|except).*|$)/,
  );
  if (m && (known.has(m[1].toLowerCase()) || aliases[m[1].toLowerCase()]))
    add(st, m[1], m[2]);
}
// Lists with a species element per record, deliberately not page-wide name searches.
for (const [st, selector] of [
  ["AR", '[id*="DataList1_Label1_"]'],
  ["NE", '[id*="CommonNameLabel_"]'],
  ["SD", '[id*="CommonNameLabel_"]'],
]) {
  const $ = await html(st);
  $(selector).each((i, e) => add(st, $(e).text()));
}
for (const st of ["IL"]) {
  const $ = await html(st);
  $(".bird-list li").each((i, e) => {
    const node = $(e).clone();
    const c = node.find(".review-conditions").text();
    node.find(".review-conditions").remove();
    add(st, node.text(), c);
  });
}
{
  const $ = await html("IN");
  const raw = $("script")
    .map((i, e) => $(e).text())
    .get()
    .find((s) => s.includes("const SPECIES ="));
  for (const m of raw.matchAll(
    /\{g:"[^"]+",\s*c:"([^"]+)",\s*s:"[^"]+",\s*n:"([^"]*)"\}/g,
  ))
    add(
      "IN",
      m[1],
      m[2] ? "Location restriction in source footnote " + m[2] : "",
    );
}
{
  const $ = await html("CO");
  $('[id*="outerDataList_lblSpecies_"]').each((i, e) => {
    const td = $(e).closest("td");
    add(
      "CO",
      $(e).text(),
      td.find("input[type=hidden]").val() === "S"
        ? norm(td.find('[id*="lblNotes"]').text())
        : "County-specific review rule; county verification required",
    );
  });
}
{
  const $ = await html("IA");
  $("a")
    .filter((i, e) =>
      /Records.*\.aspx|Species.*\.aspx/i.test($(e).attr("href") || ""),
    )
    .each((i, e) => {
      const n = norm($(e).text());
      if (known.has(n.toLowerCase()))
        add(
          "IA",
          n,
          n === "Greater Prairie-Chicken"
            ? "Outside Kellerton Grasslands only"
            : "",
        );
    });
}
{
  const $ = await html("KY");
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (td.length === 6 && norm(td.eq(5).text()) === "R")
      add("KY", td.eq(1).text());
  });
}
{
  const $ = await html("KS");
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (td.length >= 5) {
      const code = norm(td.eq(3).text());
      if (/^(R|RE|X|M)$/.test(code))
        add(
          "KS",
          td.eq(0).text(),
          code === "R"
            ? norm(td.eq(1).text())
              ? `Documentation not required: ${norm(td.eq(1).text())}`
              : ""
            : `${code}: ${norm(td.eq(1).text())}`,
        );
    }
  });
}
{
  const $ = await html("MO");
  $('[id*="SpeciesLabel_"]').each((i, e) => {
    const condition = $(e).siblings('[id*="ReviewListSuffixLabel_"]').text();
    add("MO", $(e).text(), condition);
  });
}
{
  const $ = await html("NV");
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (
      td.length === 3 &&
      /^[A-Z][a-z]+ [a-z]+\s*$/.test(norm(td.eq(1).text()))
    )
      add("NV", td.eq(0).text());
  });
}
{
  const $ = await html("VA");
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (td.first().hasClass("sp")) {
      const c = norm(td.last().text()).replace(/^✔/, "").trim();
      add("VA", td.first().text(), c);
    }
  });
}
{
  const $ = await html("DE");
  $("li").each((i, e) => {
    const n = norm($(e).text());
    if ($(e).find("b,strong").length) {
      const m = n.match(/^(.+?)\s*\([A-Z][a-z]+ [a-z]+\)/);
      if (m)
        add(
          "DE",
          m[1].replace(/[†*]/g, ""),
          n.includes("†") ? "Reviewable only from shore" : "",
        );
    }
  });
}
for (const st of ["NC", "SC"]) {
  const $ = await html(st);
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (td.length === 2) {
      const c = norm(td.eq(1).text());
      if (c && c !== "Review status")
        add(st, td.first().text(), c === "Full" ? "" : c);
    }
  });
}
for (const st of ["GA", "OH"]) {
  const $ = await html(st);
  $("p").each((i, e) => listLine(st, $(e).text()));
}
for (const st of ["MN", "MT", "WI"])
  for (const line of await lines(st)) listLine(st, line);
for (const st of ["MD", "DC"]) {
  let s = await text(st);
  s = s.slice(s.indexOf("2. Species"));
  if (st === "MD") s = s.split(/3\. /)[0];
  else s = s.split("=========")[0];
  for (const l of s.split("\n")) listLine(st, l);
}
// Regional Maryland entries are represented explicitly and held when the source
// geography cannot be verified from the incoming report.
{
  let condition = "";
  for (const l of await lines("MD")) {
    if (/^4[A-E]\./.test(l)) condition = l;
    if (condition && known.has(l.toLowerCase())) add("MD", l, condition);
  }
}
for (const l of await lines("TN"))
  if (l.startsWith("o ")) listLine("TN", l.slice(2));
// PDF columns are separated by two or more spaces. Preserve each row's conditions.
for (const st of ["MS", "WA", "LA"]) {
  let s = await text(st);
  if (st === "WA") s = s.split("Subspecies and Forms")[0];
  if (st === "LA" || st === "MS") s = s.split("\f")[0];
  for (const line of s.split("\n"))
    for (let cell of line.trim().split(/\s{2,}/)) {
      cell = norm(cell)
        .replace(/\s*\*$/, "")
        .replace(/\s*\((?:P|s|I|\d{4})\)/g, "")
        .trim();
      listLine(st, cell);
    }
}
for (const line of (await text("OR")).split("\n"))
  for (const chunk of line.split(/\s*\*|\s*\(P\)/)) {
    listLine("OR", chunk);
  }
{
  const s = await text("AL");
  for (const line of s.split("\n"))
    for (const cell of line.trim().split(/\s{2,}/)) {
      if (known.has(norm(cell).toLowerCase())) add("AL", cell);
    }
}
for (const line of await lines("AZ")) {
  const m = line.match(/^(.+?) [A-Z][a-z]+ [a-z]+\s*-\s*\*(.*)$/);
  if (m)
    add(
      "AZ",
      m[1],
      /\d/.test(m[2]) ? "See numbered source restriction " + m[2] : "",
    );
}
for (const line of (await text("AK")).split("\n")) {
  const m = norm(line).match(/^(.+?) [A-Z][a-z]+ [a-z]+ ([])$/);
  if (m)
    add("AK", m[1], "", {
      kind: "documented-status",
      status: m[2] === "" ? "casual" : "accidental",
    });
}
for (const line of (await text("WY"))
  .split(/APPENDIX|Appendix/)[0]
  .split("\n")) {
  const m = norm(line).match(/^\*(.+?) \([A-Z][a-z]+ [a-z]+\)/);
  if (m) add("WY", m[1]);
}
for (const line of (await text("WV")).split("\n")) {
  const m = norm(line).match(/^(.+?) [A-Z][a-z]+ [a-z]+\s*[:;(]/);
  if (m) add("WV", m[1]);
}
for (const l of await lines("NM")) listLine("NM", l);
for (const line of (await text("ID")).split("\n")) {
  const m = line.match(/^\s*(.+?)\s{2,}([A-Z][a-z]+ [a-z]+)\s{2,}(.*)$/);
  if (m && norm(m[3]))
    add(
      "ID",
      m[1],
      /^all\s+all\s+all\s+all$/.test(norm(m[3])) ? "" : norm(m[3]),
    );
}
{
  const $ = await html("UT");
  $("tr").each((i, e) => {
    const td = $(e).children("td");
    if (td.length < 2) return;
    const cell = td
      .filter((i, e) => {
        const t = norm($(e).text())
          .replace(/\s*\*?\s*[({].*$/, "")
          .trim();
        return known.has(t.toLowerCase()) || Boolean(aliases[t.toLowerCase()]);
      })
      .first();
    if (!cell.length) return;
    const raw = norm(cell.text());
    const name = raw.replace(/\s*\*?\s*[({].*$/, "").trim();
    if (known.has(name.toLowerCase()) || aliases[name.toLowerCase()])
      add(
        "UT",
        name,
        norm($(e).text()).includes("Except")
          ? norm($(e).text()).split("Except")[1]
          : "",
      );
  });
}
for (const line of (await text("OK")).split("For all species")[0].split("\n")) {
  const m = line
    .trim()
    .match(/^\*?(.+?)\s{2,}(Statewide|PAN|NE.*|SE.*|NW.*|SW.*)$/);
  if (m) add("OK", m[1], m[2] === "Statewide" ? "" : m[2]);
}
omitted.push({
  state: "OR",
  name: "Arctic/Kamch. Leaf Warbler",
  reason: "Species group requires taxon evidence",
});
// Captured web render is used only where direct downloads were challenged.
function webLines(s) {
  return [
    ...new Map(
      s
        .split("\n")
        .map((l) => {
          const m = l.match(/^L(\d+)(?:@P\d+(?:-\d+)?)?: (.*)$/);
          return m ? [m[1], m[2]] : null;
        })
        .filter(Boolean),
    ).values(),
  ];
}
for (const line of webLines(await readFile(`${root}/FL-web.txt`, "utf8"))) {
  const c = line.split("|").map(norm);
  if (c.length === 7 && c[6] === "Review" && !c[2] && c[5] === "Native species")
    add("FL", c[1]);
}
// Page footers can concatenate the next numbered record to the last row.
const njText = webLines(
  await readFile(`${root}/NJ-web-retry.txt`, "utf8"),
).join(" ");
const njRecords = [
  ...njText.matchAll(/(\d{1,3}) (R\*?) (.*?)(?=\d{1,3} R\*? |$)/g),
];
if (njRecords.length !== 180)
  throw new Error(`NJ source record count changed: ${njRecords.length}`);
for (const record of njRecords) {
  const body = record[3];
  const m =
    body.match(/^(.+?) [A-Z][a-z]+ [a-z]+(.*)$/) ||
    body.match(/^(.+?) [A-Z][a-z]+( \(.*)$/);
  if (m)
    add(
      "NJ",
      m[1],
      record[2] === "R*" ? norm(m[2]) || "Partial review rule in source" : "",
    );
}
const njRules = added.filter((r) => r.sourceId === "NJ");
if (
  njRules.length !== 178 ||
  omitted.filter((r) => r.state === "NJ").length !== 2
)
  throw new Error("NJ species/group reconciliation failed");
for (const record of njRecords.filter((r) => r[2] === "R*")) {
  const r = njRules.find((r) => norm(record[3]).startsWith(norm(r.name) + " "));
  if (!r?.requiresReview)
    throw new Error(`NJ partial rule lost its condition: ${record[1]}`);
}
// Hawaii's old checklist is retained for explicit review only until reconciled to the 2025 report.
for (const line of webLines(await readFile(`${root}/HI-web.txt`, "utf8"))) {
  const m = line.match(/^(.+?) [A-Z][a-z]+ [a-z]+ (?:Va|Vo)[^X]*X$/);
  if (m)
    add(
      "HI",
      m[1],
      "Historical X membership uses approximately five records per decade; current committee policy uses five lifetime records. Lifetime count requires verification.",
    );
}
// Reconcile published additions and the sixth Snow Bunting record from the
// committee's 2025 report. Established introduced birds are excluded.
for (const name of [
  "Eastern Spot-billed Duck",
  "Purple Gallinule",
  "Northern Lapwing",
  "Little Ringed Plover",
  "Temminck's Stint",
  "Jack Snipe",
  "Ross's Gull",
  "Inca Tern",
  "Ainley's Storm-Petrel",
  "Magnificent Frigatebird",
  "Bohemian Waxwing",
  "White Wagtail",
  "Rustic Bunting",
  "Common Gull",
  "Short-billed Gull",
  "Siberian Pipit",
])
  add("HI", name, "", {
    sourceUrl:
      "https://www.journal.westernfieldornithologists.org/index.php/westernbirds/article/view/354",
  });
for (const name of [
  "Baikal Teal",
  "Elegant Tern",
  "White-winged Tern",
  "Ancient Murrelet",
  "American Bittern",
  "Gray Heron",
  "White Wagtail",
  "Siberian Pipit",
  "Black-winged Stilt",
]) {
  add("HI", name);
  const r = added.find((r) => r.sourceId === "HI" && r.name === name);
  delete r.condition;
  delete r.requiresReview;
  r.sourceUrl =
    "https://www.journal.westernfieldornithologists.org/index.php/westernbirds/article/view/354";
}
for (const name of ["Common Gull", "Snow Bunting"]) {
  const r = added.find((r) => r.sourceId === "HI" && r.name === name);
  if (r) {
    r.requiresReview = true;
    r.condition =
      "Six lifetime records in the 2025 report; current committee review policy needs explicit confirmation";
  }
}
{
  const $ = load(await readFile(`${root}/ND-archive.html`, "utf8"));
  $("tr").each((i, e) => {
    const td = $(e).find("td");
    if (td.length === 2) {
      const name = norm(td.first().text());
      if (known.has(name.toLowerCase()) || aliases[name.toLowerCase()])
        add("ND", name, td.last().text());
    }
  });
}
// The third RIARC report explicitly enumerates every review species then in force.
let ri = await text("RI");
ri = ri
  .slice(
    ri.indexOf(
      "Third Report of the Rhode Island Avian Records",
      ri.indexOf("Third Report of the Rhode Island Avian Records") + 1,
    ),
  )
  .split("Literature Cited")[0];
for (const l of ri.split("\n")) {
  const m = norm(l).match(/^(.+?) \([A-Z][a-z]+ [a-z]+\) \([\d+, ]+\)/);
  if (m) add("RI", m[1]);
}
for (const suffix of ["4", "5", "6", "7"]) {
  for (const l of (await text("RI" + suffix)).split("\n")) {
    const m = norm(l).match(
      /^([A-Za-z][A-Za-z '\-]+?) \([A-Z][a-z]+ [a-z]+\) \([\d+, ]+\)/,
    );
    if (m)
      add("RI", m[1], "", {
        sourceUrl: {
          4: "https://www.birdobserver.org/Issues/2023/October-2023/fourth-report-of-the-rhode-island-avian-records-committee-review-of-recent-reports-through-2020",
          5: "https://www.birdobserver.org/Issues/2024/August-2024/fifth-report-of-the-rhode-island-avian-records-committee",
          6: "https://www.birdobserver.org/Issues/2025/October-2025/sixth-report-of-the-rhode-island-avian-records-committee",
          7: "https://www.birdobserver.org/Issues/2026/October-2026/seventh-report-of-the-rhode-island-avian-records-committee",
        }[suffix],
      });
  }
}
for (const name of ["Sandhill Crane", "Cackling Goose"]) {
  const i = added.findIndex((r) => r.sourceId === "RI" && r.name === name);
  if (i >= 0) added.splice(i, 1);
}
add(
  "RI",
  "Cackling Goose",
  "Only forms other than nominate hutchinsii; source removed nominate in 2023",
);
for (const name of ["American Avocet", "Tricolored Heron", "Northern Shrike"]) {
  add("RI", name);
  added.find((r) => r.sourceId === "RI" && r.name === name).sourceUrl =
    "https://www.birdobserver.org/Issues/2026/October-2026/seventh-report-of-the-rhode-island-avian-records-committee";
}
// Complete conditional species accounting in the original Northeast sources.
// These entries are kept out of automatic headlines until their restrictions
// have a dedicated matcher backed by report fields.
const northeastRoot = process.argv[3];
if (!northeastRoot)
  throw new Error(
    "Supply the original Northeast capture directory as the second argument",
  );
{
  const $ = load(await readFile(`${northeastRoot}/NY.html`, "utf8"));
  $("s,strike,del").remove();
  $("br").replaceWith("|||");
  $("p").append("|||");
  for (const line of $("body").text().split("|||")) {
    const t = norm(line);
    if (/REMOVED|REPLACED|LUMPED/.test(t)) continue;
    const m = t.match(
      /^([A-Za-z][A-Za-z '\-]+?)\s+[A-Z](?:[a-z]+\.?|\.)\s*[a-z]+(?: [a-z-]+)*\s+\(([^)]+)\)/,
    );
    if (
      m &&
      !registry.rules.some(
        (r) => r.sourceId === "NY" && norm(r.name) === norm(m[1]),
      )
    )
      add("NY", m[1], t);
  }
}
{
  const $ = load(await readFile(`${northeastRoot}/CT.html`, "utf8"));
  const section = $(".entry-content h3")
    .eq(1)
    .nextAll(".wp-block-columns")
    .first();
  section.find("br").replaceWith("\n");
  section.find("p").each((i, e) => {
    for (const name of $(e).text().split("\n"))
      if (
        known.has(norm(name).toLowerCase()) &&
        !registry.rules.some(
          (r) => r.sourceId === "CT" && norm(r.name) === norm(name),
        )
      )
        add(
          "CT",
          name,
          "Breeding record documentation only; nesting evidence required",
        );
  });
}
// Original state source metadata stays authoritative for these added holds.
for (const r of added.filter((r) => ["CT", "NY"].includes(r.sourceId)))
  if (!registry.rules.some((x) => x.id === r.id)) registry.rules.push(r);
// Keep original RI additions if the source report text was unavailable.
for (const state of Object.keys(authorities)) {
  const existing = registry.sources.find((x) => x.id === state);
  const stateRules = added.filter((x) => x.sourceId === state);
  if (!stateRules.length) {
    console.error("NO RULES", state);
    continue;
  }
  if (!existing || ["NJ", "RI"].includes(state)) {
    registry.rules = registry.rules.filter((x) => x.sourceId !== state);
    registry.rules.push(...stateRules);
  }
  const evidence =
    state === "FL"
      ? "FL-web.txt"
      : state === "NJ"
        ? "NJ-web-retry.txt"
        : state === "ND"
          ? "ND-archive.txt"
          : state === "HI"
            ? "HI-web.txt"
            : `${state}.txt`;
  const raw = await readFile(`${root}/${evidence}`);
  const src = {
    id: state,
    state: "US-" + state,
    authority: authorities[state],
    url:
      sourceUrls[state] ||
      {
        FL: "https://fosbirds.org/fos-bird-checklist/",
        NJ: "https://www.njbrc.com/documents/NJReviewList2026.pdf",
        ND: "https://ndbirdingsociety.org/Birds/Records.aspx",
        HI: "https://westernfieldornithologists.org/wp-content/uploads/2020/06/Hawaiian_Islands_Bird_Checklist-Jan-2019.pdf",
      }[state],
    retrieved: "2026-11-17",
    sha256: createHash("sha256").update(raw).digest("hex"),
    capture: evidence,
    scope:
      "Species-level source rules. Conditional entries are held pending explicit evidence; no inferred eligibility.",
    verification: "source-checked",
  };
  if (existing) Object.assign(existing, src);
  else registry.sources.push(src);
}
registry.sources.find((s) => s.id === "ND").url =
  "https://web.archive.org/web/20260614135951/https://ndbirdingsociety.org/Birds/Records.aspx";
registry.sources.find((s) => s.id === "ND").archiveDate = "2026-06-14";
registry.sources.find((s) => s.id === "ND").scope =
  "June 14, 2026 archived primary review list. Original live domain redirects to unrelated content; archived scope and conditions retained.";
registry.sources.find((s) => s.id === "HI").url =
  "https://westernfieldornithologists.org/wp-content/uploads/2020/06/Hawaiian_Islands_Bird_Checklist-Jan-2019.pdf";
registry.sources.find((s) => s.id === "HI").supportingSources = [
  "https://www.journal.westernfieldornithologists.org/index.php/westernbirds/article/view/354",
  "https://westernfieldornithologists.org/hawaii-birds-records-committee/",
];
registry.sources.find((s) => s.id === "NJ").url =
  "https://www.njbrc.com/documents/NJReviewList2026.pdf";
registry.sources.find((s) => s.id === "RI").supportingSources = [
  "https://www.birdobserver.org/Issues/2023/October-2023/fourth-report-of-the-rhode-island-avian-records-committee-review-of-recent-reports-through-2020",
  "https://www.birdobserver.org/Issues/2024/August-2024/fifth-report-of-the-rhode-island-avian-records-committee",
  "https://www.birdobserver.org/Issues/2025/October-2025/sixth-report-of-the-rhode-island-avian-records-committee",
  "https://www.birdobserver.org/Issues/2026/October-2026/seventh-report-of-the-rhode-island-avian-records-committee",
];
registry.unmatchedSourceTaxa = omitted;
registry.version = "review-lists-2026-11-17";
await writeFile(
  "shared/digestSelectionRules.json",
  JSON.stringify(registry, null, 2) + "\n",
);
await writeFile(
  `${root}/omitted-taxa.json`,
  JSON.stringify(omitted, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      sources: registry.sources.length,
      rules: registry.rules.length,
      counts: Object.fromEntries(
        registry.sources.map((s) => [
          s.id,
          registry.rules.filter((r) => r.sourceId === s.id).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
