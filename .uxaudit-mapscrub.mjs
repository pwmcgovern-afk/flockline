import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://flockline.app";
const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/mapscrub";
fs.mkdirSync(SHOTS, { recursive: true });

const KILL_ANIM = `*, *::before, *::after { transition: none !important; animation: none !important; transition-duration: 0s !important; animation-duration: 0s !important; }`;

export async function newPage(browser, { width = 1440, height = 900, tour = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  if (tour) {
    await ctx.addInitScript(() => {
      try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {}
    });
  }
  return { ctx, page };
}

export async function freeze(page) {
  await page.addStyleTag({ content: KILL_ANIM });
  await page.evaluate(() => { void document.body.offsetHeight; });
}

// Read Leaflet zoom + approx bounds from loaded tile URLs (prod build has no
// __flocklineMap hook). Tile path is /{style}/{z}/{x}/{y}{@2x}.png
export async function mapState(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll(".leaflet-tile-pane img")];
    const tiles = [];
    for (const img of imgs) {
      const m = img.src.match(/light_(?:nolabels|only_labels)\/(\d+)\/(\d+)\/(\d+)/);
      if (m) tiles.push({ z: +m[1], x: +m[2], y: +m[3] });
    }
    const zooms = [...new Set(tiles.map((t) => t.z))];
    // the "live" zoom = the zoom of the most tiles
    const counts = {};
    for (const t of tiles) counts[t.z] = (counts[t.z] || 0) + 1;
    const z = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN);
    const at = tiles.filter((t) => t.z === z);
    const t2ll = (x, y, zz) => {
      const n = 2 ** zz;
      const lng = (x / n) * 360 - 180;
      const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
      return { lat: (latRad * 180) / Math.PI, lng };
    };
    let bounds = null;
    if (at.length) {
      const xs = at.map((t) => t.x), ys = at.map((t) => t.y);
      const nw = t2ll(Math.min(...xs), Math.min(...ys), z);
      const se = t2ll(Math.max(...xs) + 1, Math.max(...ys) + 1, z);
      bounds = { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
    }
    const zc = document.querySelector(".leaflet-control-zoom");
    return {
      zoom: z,
      zooms,
      tileCount: at.length,
      bounds,
      dots: document.querySelectorAll(".leaflet-overlay-pane canvas").length,
      zoomInDisabled: !!zc?.querySelector(".leaflet-control-zoom-in.leaflet-disabled"),
      zoomOutDisabled: !!zc?.querySelector(".leaflet-control-zoom-out.leaflet-disabled")
    };
  });
}

export async function readUi(page) {
  return page.evaluate(() => {
    const txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
    const scrub = document.querySelector(".scrubber");
    const rail = document.querySelector(".day-rail");
    const bars = [...document.querySelectorAll(".histogram button")];
    return {
      title: txt(".masthead-title"),
      meta: txt(".masthead-meta"),
      scrubberPresent: !!scrub,
      scrubDate: txt(".scrubber-date"),
      scrubFoot: txt(".scrubber-foot"),
      dayIndex: rail ? Number(rail.value) : null,
      dayMax: rail ? Number(rail.max) : null,
      mode: document.querySelector(".segmented button.active")?.textContent?.trim() ?? null,
      playLabel: document.querySelector(".play-button")?.getAttribute("aria-label") ?? null,
      barCount: bars.length,
      barLabels: bars.map((b) => b.getAttribute("aria-label")),
      barClasses: bars.map((b) => b.className),
      barHeights: bars.map((b) => b.style.height),
      sheetOpen: !!document.querySelector(".sighting-sheet"),
      sheetName: txt(".sighting-sheet h2"),
      sheetPlace: txt(".sighting-sheet .sighting-place"),
      sheetFacts: [...document.querySelectorAll(".sighting-sheet .sighting-facts span")].map((s) => s.textContent.trim()),
      sheetDetail: txt(".sighting-sheet .sighting-details"),
      url: location.href
    };
  });
}

export async function waitLoaded(page, ms = 25000) {
  await page.waitForSelector(".scrubber", { timeout: ms }).catch(() => {});
  await page.waitForFunction(
    () => !/Counting/.test(document.querySelector(".masthead-meta")?.textContent ?? ""),
    null,
    { timeout: ms }
  ).catch(() => {});
  await page.waitForTimeout(700);
}

export async function shot(page, name) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p });
  return p;
}

export { BASE, SHOTS };
