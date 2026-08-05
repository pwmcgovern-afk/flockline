import { launch, page, settle, view, project, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);
let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) { try { payload = await r.json(); } catch {} }
});

const hitAll = () => p.evaluate(() => {
  const probe = (label, sel) => {
    const e = document.querySelector(sel);
    if (!e) return `${label}: MISSING`;
    const b = e.getBoundingClientRect();
    if (!b.width || !b.height) return `${label}: zero-size`;
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    const ok = e === top || e.contains(top) || (top && top.contains(e));
    return `${label}: ${ok ? "REACHABLE" : "BLOCKED by " + (top ? top.tagName + "." + String(top.className).split(" ")[0] : "?")} [${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}]`;
  };
  return [
    probe("play", ".play-button"),
    probe("rail", "input.day-rail"),
    probe("bar0", ".histogram button"),
    probe("modeNew", ".scrubber .segmented button"),
    probe("tab1", ".tab-bar button"),
    probe("tabLast", ".tab-bar button:last-child"),
    probe("footLink", ".scrubber-foot .link"),
    probe("sheetClose", "aside.sighting-sheet [aria-label='Close sighting details']")
  ];
});

await p.setViewportSize({ width: 375, height: 667 });
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1500);

console.log("=== 375x667, no record open ===");
console.log((await hitAll()).join("\n"));
const v0 = await view(p);
console.log("view:", JSON.stringify({ zoom: v0.zoom, center: v0.center, container: v0.container }));
await p.screenshot({ path: `${SHOTS}/07-mobile-no-record.png` });

// open a record
const v = await view(p);
let opened = null;
for (const f of payload.featureCollection.features) {
  const [lng, lat] = f.geometry.coordinates;
  const s = await project(p, lat, lng);
  if (s && s.x > 30 && s.x < 345 && s.y > v.container.y + 30 && s.y < v.container.y + 180) {
    await p.mouse.click(s.x, s.y);
    await p.waitForTimeout(700);
    if (await p.locator("aside.sighting-sheet").count()) { opened = f.properties.locName; break; }
  }
}
await killMotion(p);
console.log(`\n=== 375x667, record open ("${opened}") ===`);
console.log((await hitAll()).join("\n"));

// can you still tap a bottom tab?
try {
  await p.locator(".tab-bar button", { hasText: "Insights" }).click({ timeout: 2500 });
  console.log("tapped Insights: OK");
} catch (e) {
  console.log("tapped Insights: FAILED ->", String(e).split("\n")[0].slice(0, 160));
}
await p.waitForTimeout(500);
console.log("drawer open?", await p.locator("aside.drawer").count());

// does the sheet scroll internally / is content clipped?
const clip = await p.evaluate(() => {
  const a = document.querySelector("aside.sighting-sheet");
  if (!a) return null;
  const f = a.querySelector("footer");
  return {
    scrollH: a.scrollHeight, clientH: a.clientHeight,
    footerVisible: f ? (f.getBoundingClientRect().bottom <= a.getBoundingClientRect().bottom + 1) : null,
    footerRect: f ? JSON.stringify(f.getBoundingClientRect()) : null
  };
});
console.log("sheet scroll:", JSON.stringify(clip));
await p.screenshot({ path: `${SHOTS}/07-mobile-record-open.png` });

console.log("\n=== zoom extremes (desktop) ===");
await p.setViewportSize({ width: 1280, height: 860 });
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1200);
const zi = p.locator(".leaflet-control-zoom-in");
const zo = p.locator(".leaflet-control-zoom-out");
for (let i = 0; i < 16; i++) { await zo.click({ force: true }); await p.waitForTimeout(120); }
await settle(p, 900);
const outV = await view(p);
console.log("max zoom out:", JSON.stringify({ zoom: outV.zoom, center: outV.center, bounds: outV.bounds }));
console.log("zoom-out button disabled class:", await p.evaluate(() => document.querySelector(".leaflet-control-zoom-out").className));
await p.screenshot({ path: `${SHOTS}/07-zoom-out-max.png` });

for (let i = 0; i < 24; i++) { await zi.click({ force: true }); await p.waitForTimeout(110); }
await settle(p, 900);
const inV = await view(p);
console.log("max zoom in:", JSON.stringify({ zoom: inV.zoom, center: inV.center }));
console.log("zoom-in button class:", await p.evaluate(() => document.querySelector(".leaflet-control-zoom-in").className));
console.log("scrubber still ok:", (await hitAll()).join(" | "));
await p.screenshot({ path: `${SHOTS}/07-zoom-in-max.png` });

// scroll zoom
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1200);
const vv = await view(p);
await p.mouse.move(640, vv.container.y + 200);
await p.mouse.wheel(0, -600);
await p.waitForTimeout(900);
await killMotion(p);
console.log("after scroll-zoom in:", JSON.stringify((await view(p)).zoom));
await p.mouse.wheel(0, 2000);
await p.waitForTimeout(900);
await killMotion(p);
console.log("after scroll-zoom out:", JSON.stringify((await view(p)).zoom));

await browser.close();
