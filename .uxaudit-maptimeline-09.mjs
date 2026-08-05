import { launch, page, waitForData, project, view, SHOTS, BASE } from "./.uxaudit-maptimeline-surface.mjs";

// NO motion-kill anywhere in this file: pure production rendering.
const browser = await launch();
const p = await page(browser);
let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) { try { payload = await r.json(); } catch {} }
});

await p.goto(`${BASE}/?bird=osprey&days=7&states=US-ME`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await p.waitForTimeout(2500);

const computed = await p.evaluate(() => {
  const e = document.querySelector(".flock-pulse-icon");
  if (!e) return null;
  const cs = getComputedStyle(e);
  return { position: cs.position, transform: cs.transform, cls: e.className, inline: e.getAttribute("style"), parent: e.parentElement.className };
});
console.log("computed style of first pulse icon:", JSON.stringify(computed, null, 1));

const pl = await p.evaluate(() => [...document.querySelectorAll(".flock-pulse-icon")].map(e => {
  const b = e.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}));
const day = await p.evaluate(() => (document.querySelector(".scrubber-date").textContent || "").trim());
console.log("date:", day, "pulses:", pl.length);
const latest = payload.featureCollection.features
  .map(f => f.properties.obsDt.slice(0, 10)).sort().at(-1);
const todayFeats = payload.featureCollection.features.filter(f => f.properties.obsDt.slice(0, 10) === latest).slice(0, 16);
console.log("latest day in payload:", latest, "features that day:", todayFeats.length);
let maxErr = 0;
for (let i = 0; i < Math.min(pl.length, todayFeats.length); i++) {
  const [lng, lat] = todayFeats[i].geometry.coordinates;
  const s = await project(p, lat, lng);
  const dy = Math.round(pl[i].y - s.y), dx = Math.round(pl[i].x - s.x);
  maxErr = Math.max(maxErr, Math.abs(dy));
  console.log(`  ${String(i).padStart(2)} ${todayFeats[i].properties.locName.slice(0, 30).padEnd(30)} proj(${Math.round(s.x)},${Math.round(s.y)}) pulse(${pl[i].x},${pl[i].y})  dx=${dx} dy=${dy}`);
}
console.log("max vertical error (px):", maxErr);
await p.screenshot({ path: `${SHOTS}/09-pulse-offset-maine.png` });

// how far off in real distance?
const v = await view(p);
const metersPerPx = 156543.03392 * Math.cos((v.center.lat * Math.PI) / 180) / Math.pow(2, v.zoom);
console.log(`zoom ${v.zoom}, ~${Math.round(metersPerPx)} m/px -> worst pulse is ~${Math.round(maxErr * metersPerPx / 1000)} km south of its sighting`);

await browser.close();
