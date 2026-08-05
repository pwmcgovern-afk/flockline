// UX audit harness: map / timeline scrubber / sighting record. Read-only.
import { chromium } from "playwright";
import fs from "node:fs";

const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/mapshots";
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = "https://flockline.app";

const KILL_MOTION = `
  (() => {
    let s = document.getElementById("__uxaudit_killmotion");
    if (!s) {
      s = document.createElement("style");
      s.id = "__uxaudit_killmotion";
      s.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}";
      document.head.appendChild(s);
    }
    document.body.getBoundingClientRect();
    return true;
  })()
`;

// Leaflet's map object is not exposed in prod builds, so derive the camera from
// a loaded tile: src carries /{z}/{x}/{y}, and the tile's screen rect anchors
// world pixels to screen pixels.
const MAP_VIEW = `
  (() => {
    const container = document.querySelector(".leaflet-container");
    if (!container) return { error: "no leaflet container" };
    const tiles = [...document.querySelectorAll("img.leaflet-tile")].filter(t => t.src.includes("light_nolabels"));
    if (!tiles.length) return { error: "no tiles" };
    const t = tiles[0];
    const m = t.src.match(/\\/(\\d+)\\/(\\d+)\\/(\\d+)(@2x)?\\.png/);
    if (!m) return { error: "bad tile src: " + t.src };
    const z = +m[1], tx = +m[2], ty = +m[3];
    const r = t.getBoundingClientRect();
    const size = r.width; // rendered tile size in css px
    const world = size * Math.pow(2, z);
    const cr = container.getBoundingClientRect();
    const toLngLat = (sx, sy) => {
      const wx = tx * size + (sx - r.left);
      const wy = ty * size + (sy - r.top);
      const lng = (wx / world) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * wy) / world;
      const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return [lat, lng];
    };
    const nw = toLngLat(cr.left, cr.top);
    const se = toLngLat(cr.right, cr.bottom);
    const c = toLngLat(cr.left + cr.width / 2, cr.top + cr.height / 2);
    return {
      zoom: z,
      tileSize: size,
      center: { lat: +c[0].toFixed(4), lng: +c[1].toFixed(4) },
      bounds: { north: +nw[0].toFixed(4), west: +nw[1].toFixed(4), south: +se[0].toFixed(4), east: +se[1].toFixed(4) },
      container: { x: cr.left, y: cr.top, w: cr.width, h: cr.height }
    };
  })()
`;

// Inverse: lat/lng -> screen px, using the same tile anchor.
const PROJECT = `
  ((lat, lng) => {
    const tiles = [...document.querySelectorAll("img.leaflet-tile")].filter(t => t.src.includes("light_nolabels"));
    if (!tiles.length) return null;
    const t = tiles[0];
    const m = t.src.match(/\\/(\\d+)\\/(\\d+)\\/(\\d+)(@2x)?\\.png/);
    if (!m) return null;
    const z = +m[1], tx = +m[2], ty = +m[3];
    const r = t.getBoundingClientRect();
    const size = r.width;
    const world = size * Math.pow(2, z);
    const wx = ((lng + 180) / 360) * world;
    const s = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
    return { x: r.left + (wx - tx * size), y: r.top + (wy - ty * size) };
  })
`;

export async function launch() {
  const browser = await chromium.launch();
  return browser;
}

export async function page(browser, { width = 1280, height = 860 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {}
  });
  const p = await ctx.newPage();
  p.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [console.error]", msg.text().slice(0, 240));
  });
  p.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 240)));
  return p;
}

export async function settle(p, ms = 900) {
  await p.waitForTimeout(ms);
  await p.evaluate(KILL_MOTION);
  await p.waitForTimeout(60);
}

export const view = (p) => p.evaluate(MAP_VIEW);
export const project = (p, lat, lng) => p.evaluate(`(${PROJECT})(${lat}, ${lng})`);
export const killMotion = (p) => p.evaluate(KILL_MOTION);
export { SHOTS, BASE };

export async function waitForData(p, timeout = 30000) {
  await p.waitForFunction(
    () => {
      const meta = document.querySelector(".masthead-meta");
      return meta && !/Counting/.test(meta.textContent || "");
    },
    null,
    { timeout }
  ).catch(() => {});
  await p.waitForTimeout(400);
}

export async function snapshot(p) {
  return p.evaluate(() => {
    const txt = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
    };
    const rail = document.querySelector("input.day-rail");
    const bars = [...document.querySelectorAll(".histogram button")];
    return {
      title: txt(".masthead-title"),
      meta: txt(".masthead-meta"),
      scrubDate: txt(".scrubber-date"),
      scrubFoot: txt(".scrubber-foot"),
      indexLine: txt(".sighting-index p"),
      rail: rail ? { value: rail.value, min: rail.min, max: rail.max } : null,
      bars: bars.length,
      barClasses: bars.map((b) => b.className),
      barHeights: bars.map((b) => b.style.height),
      mode: (document.querySelector(".segmented .active") || {}).textContent || null,
      playLabel: (document.querySelector(".play-button") || {}).getAttribute
        ? document.querySelector(".play-button").getAttribute("aria-label")
        : null,
      url: location.href
    };
  });
}
