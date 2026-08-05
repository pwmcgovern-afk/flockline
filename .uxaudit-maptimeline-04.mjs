import { launch, page, settle, view, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);

const info = () => p.evaluate(() => {
  const txt = (s) => { const e = document.querySelector(s); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  return {
    meta: txt(".masthead-meta"),
    foot: txt(".scrubber-foot"),
    note: txt(".map-note"),
    empty: txt(".map-empty") || txt(".stage .empty") || null,
    index: txt(".sighting-index p")
  };
});

// data bounds straight from the API, to compare against what the camera shows
async function dataBounds(pg) {
  return pg.evaluate(async () => {
    const st = window.__lastPayload;
    return st || null;
  });
}

const cases = [
  { label: "osprey NE 7d", url: "/?bird=osprey&days=7" },
  { label: "osprey NE 1d", url: "/?bird=osprey&days=1" },
  { label: "osprey NE 30d", url: "/?bird=osprey&days=30" },
  { label: "kirtland's warbler (very rare) NE 30d", url: "/?bird=kirwar&days=30" },
  { label: "snowy owl (rare in Aug) NE 30d", url: "/?bird=snoowl1&days=30" },
  { label: "am robin nationwide 7d", url: "/?bird=amerob&region=nationwide&days=7" },
  { label: "osprey single state CT 7d", url: "/?bird=osprey&states=US-CT&days=7" }
];

for (const c of cases) {
  await p.goto(BASE + c.url, { waitUntil: "domcontentloaded" });
  await waitForData(p, 45000);
  await settle(p, 1400);
  const v = await view(p);
  const i = await info();
  console.log(`\n--- ${c.label} (${c.url})`);
  console.log("  view:", JSON.stringify(v.zoom !== undefined ? { zoom: v.zoom, center: v.center, bounds: v.bounds } : v));
  console.log("  meta:", i.meta);
  console.log("  foot:", i.foot);
  console.log("  index:", i.index);
  console.log("  note:", i.note, "| empty:", i.empty);
  console.log("  url:", await p.evaluate(() => location.href));
  await p.screenshot({ path: `${SHOTS}/04-${c.label.replace(/[^a-z0-9]+/gi, "-")}.png` });
}

await browser.close();
