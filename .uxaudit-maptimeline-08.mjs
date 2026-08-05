import { launch, page, settle, view, project, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);
let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) { try { payload = await r.json(); } catch {} }
});

// robust zoom: modal z among tiles actually intersecting the container
const realZoom = () => p.evaluate(() => {
  const c = document.querySelector(".leaflet-container").getBoundingClientRect();
  const counts = {};
  for (const t of document.querySelectorAll("img.leaflet-tile")) {
    const b = t.getBoundingClientRect();
    if (b.right < c.left || b.left > c.right || b.bottom < c.top || b.top > c.bottom) continue;
    if (!b.width) continue;
    const m = t.src.match(/\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
});

const pulses = () => p.evaluate(() => {
  return [...document.querySelectorAll(".flock-pulse-icon")].map((e) => {
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), t: e.style.transform };
  });
});

await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await p.waitForTimeout(1600);

console.log("=== zoom 6 (initial fit) ===");
console.log("tile z counts:", JSON.stringify(await realZoom()));
const v6 = await view(p);
console.log("view zoom:", v6.zoom);
const pl6 = await pulses();
console.log("pulse count:", pl6.length);
// expected pulse features: visibleFeatures with obsDt day == selectedDateKey, first 16
const sel = await p.evaluate(() => (document.querySelector(".scrubber-date").textContent || "").trim());
console.log("scrubber date:", sel);
const today = payload.featureCollection.features.filter(f => f.properties.obsDt.slice(0, 10) === "2026-08-05").slice(0, 16);
console.log("candidate latest-day features:", today.length);
for (let i = 0; i < Math.min(6, today.length); i++) {
  const [lng, lat] = today[i].geometry.coordinates;
  const s = await project(p, lat, lng);
  console.log(`  feat[${i}] ${today[i].properties.locName.slice(0, 34)} -> projected (${Math.round(s.x)},${Math.round(s.y)})  pulse[${i}] (${pl6[i]?.x},${pl6[i]?.y})`);
}

console.log("\n=== zoom right out ===");
for (let i = 0; i < 10; i++) { await p.locator(".leaflet-control-zoom-out").click({ force: true }); await p.waitForTimeout(160); }
await p.waitForTimeout(1500);
console.log("tile z counts:", JSON.stringify(await realZoom()));
const pl0 = await pulses();
console.log("pulse positions at min zoom:", JSON.stringify(pl0.map(q => [q.x, q.y])));
const v0 = await view(p);
console.log("view:", JSON.stringify({ zoom: v0.zoom, bounds: v0.bounds, container: v0.container }));
// where the same features project to
for (let i = 0; i < Math.min(4, today.length); i++) {
  const [lng, lat] = today[i].geometry.coordinates;
  console.log(`  feat[${i}] -> projected`, JSON.stringify(await project(p, lat, lng)));
}
await p.screenshot({ path: `${SHOTS}/08-zoom-min-animations-on.png` });
console.log("zoom-out disabled?", await p.evaluate(() => document.querySelector(".leaflet-control-zoom-out").classList.contains("leaflet-disabled")));

console.log("\n=== zoom right in ===");
for (let i = 0; i < 22; i++) { await p.locator(".leaflet-control-zoom-in").click({ force: true }); await p.waitForTimeout(150); }
await p.waitForTimeout(1800);
console.log("tile z counts:", JSON.stringify(await realZoom()));
console.log("zoom-in disabled?", await p.evaluate(() => document.querySelector(".leaflet-control-zoom-in").classList.contains("leaflet-disabled")));
await p.screenshot({ path: `${SHOTS}/08-zoom-max-in.png` });
const geomAtMax = await p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  return { scrubber: r(".scrubber"), attribution: r(".leaflet-control-attribution"), zoomctl: r(".leaflet-control-zoom"), note: (document.querySelector(".map-note") || {}).textContent };
});
console.log("geometry at max zoom:", JSON.stringify(geomAtMax));

await browser.close();
