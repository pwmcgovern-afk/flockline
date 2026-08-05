import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const SHOT_DIR = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/maptl";
fs.mkdirSync(SHOT_DIR, { recursive: true });
const BASE = "https://flockline.app";
const KILL_MOTION = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
function trackSightings(page) {
  const store = { last: null };
  page.on("response", async (res) => {
    if (!res.url().includes("/api/sightings")) return;
    try { store.last = await res.json(); } catch {}
  });
  return store;
}
async function settle(page, ms = 500) {
  await page.addStyleTag({ content: KILL_MOTION }).catch(() => {});
  await page.evaluate(() => { void document.body.offsetHeight; });
  await page.waitForTimeout(ms);
  await page.addStyleTag({ content: KILL_MOTION }).catch(() => {});
  await page.evaluate(() => { void document.body.offsetHeight; });
}
const MAP_STATE = () => {
  const container = document.querySelector(".leaflet-container");
  if (!container) return { error: "no container" };
  const tiles = [...container.querySelectorAll("img.leaflet-tile")].filter((t) => t.src.includes("cartocdn"));
  if (!tiles.length) return { error: "no tiles" };
  const parse = (s) => { const m = s.match(/\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png/); return m ? { z: +m[1], x: +m[2], y: +m[3] } : null; };
  const counts = {}; for (const t of tiles) { const p = parse(t.src); if (p) counts[p.z] = (counts[p.z] || 0) + 1; }
  const z = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const tile = tiles.find((t) => { const p = parse(t.src); return p && p.z === z; });
  const p = parse(tile.src); const r = tile.getBoundingClientRect(); const scale = r.width / 256;
  const cr = container.getBoundingClientRect(); const ws = 256 * Math.pow(2, z);
  const toWorld = (sx, sy) => [p.x * 256 + (sx - r.left) / scale, p.y * 256 + (sy - r.top) / scale];
  const toLatLng = ([wx, wy]) => { const lng = (wx / ws) * 360 - 180; const n = Math.PI - (2 * Math.PI * wy) / ws; return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng]; };
  const nw = toLatLng(toWorld(cr.left, cr.top)); const se = toLatLng(toWorld(cr.right, cr.bottom));
  const c = toLatLng(toWorld(cr.left + cr.width / 2, cr.top + cr.height / 2));
  return { zoom: z, center: [+c[0].toFixed(3), +c[1].toFixed(3)], north: +nw[0].toFixed(3), west: +nw[1].toFixed(3), south: +se[0].toFixed(3), east: +se[1].toFixed(3), container: { w: Math.round(cr.width), h: Math.round(cr.height) } };
};
const PROJECT = ([lat, lng]) => {
  const container = document.querySelector(".leaflet-container");
  const tiles = [...container.querySelectorAll("img.leaflet-tile")].filter((t) => t.src.includes("cartocdn"));
  const parse = (s) => { const m = s.match(/\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png/); return m ? { z: +m[1], x: +m[2], y: +m[3] } : null; };
  const counts = {}; for (const t of tiles) { const p = parse(t.src); if (p) counts[p.z] = (counts[p.z] || 0) + 1; }
  const z = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const tile = tiles.find((t) => { const p = parse(t.src); return p && p.z === z; });
  const p = parse(tile.src); const r = tile.getBoundingClientRect(); const scale = r.width / 256; const ws = 256 * Math.pow(2, z);
  const wx = ((lng + 180) / 360) * ws; const s = Math.sin((lat * Math.PI) / 180);
  const wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws;
  return [r.left + (wx - p.x * 256) * scale, r.top + (wy - p.y * 256) * scale];
};
async function shot(page, name) { const p = path.join(SHOT_DIR, name + ".png"); await page.screenshot({ path: p }); return p; }
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
const page = await ctx.newPage();
await page.goto(`${BASE}/?bird=osprey&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.querySelector(".masthead-meta")?.textContent?.includes("Counting"), null, { timeout: 45000 });
await settle(page, 1000);
const res = await page.evaluate(() => {
  const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
  const bg = parse(getComputedStyle(document.querySelector(".scrubber")).backgroundColor);
  const out = {};
  for (const sel of [".scrubber-foot", ".scrubber-foot strong", ".scrubber-foot .link", ".ramp-key", ".scrubber-date", ".scrubber .segmented button:not(.active)", ".scrubber .segmented button.active"]) {
    const e = document.querySelector(sel); if (!e) { out[sel] = "missing"; continue; }
    const cs = getComputedStyle(e);
    out[sel] = { color: cs.color, size: cs.fontSize, weight: cs.fontWeight, ratioVsCard: ratio(parse(cs.color), bg) };
  }
  out.cardBg = getComputedStyle(document.querySelector(".scrubber")).backgroundColor;
  // histogram future bar effective colour over the card
  const fut = document.querySelector(".histogram button.future") || document.querySelector(".histogram button:last-child");
  if (fut) { const cs = getComputedStyle(fut); out.futureBar = { bg: cs.backgroundColor, opacity: cs.opacity }; }
  return out;
});
log(JSON.stringify(res, null, 1));
// tooltip / title-only affordance on New / Trail
log("New/Trail explanatory text on screen:", await page.evaluate(() => {
  const b = [...document.querySelectorAll(".scrubber .segmented button")];
  return b.map((x) => ({ text: x.innerText, title: x.title, ariaDesc: x.getAttribute("aria-describedby") }));
}));
await browser.close();
