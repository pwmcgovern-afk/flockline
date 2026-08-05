// UX audit harness: map / timeline / sighting record. Read-only against prod.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://flockline.app";
const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/shots-maptl";
fs.mkdirSync(SHOTS, { recursive: true });

const PHASE = process.argv[2] || "all";
const log = (...a) => console.log(...a);

// ---------- in-page helpers (stringified, injected) ----------
const HELPERS = `
window.__ux = {
  killMotion() {
    if (document.getElementById('__uxkill')) return;
    const s = document.createElement('style');
    s.id = '__uxkill';
    s.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.head.appendChild(s);
    void document.body.offsetHeight;
  },
  mapView() {
    const container = document.querySelector('.leaflet-container');
    if (!container) return null;
    const cr = container.getBoundingClientRect();
    const imgs = [...document.querySelectorAll('img.leaflet-tile-loaded')];
    const tile = imgs.find(i => i.src.includes('light_nolabels')) || imgs[0];
    if (!tile) return { err: 'no tiles', cr };
    const m = tile.src.match(/\\/(\\d+)\\/(\\d+)\\/(\\d+)(@2x)?\\.png/);
    if (!m) return { err: 'bad tile src: ' + tile.src };
    const z = +m[1], tx = +m[2], ty = +m[3];
    const tr = tile.getBoundingClientRect();
    const tileSize = tr.width;
    const world = tileSize * Math.pow(2, z);
    const px2ll = (wx, wy) => {
      const lng = wx / world * 360 - 180;
      const n = Math.PI - 2 * Math.PI * wy / world;
      const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return [lat, lng];
    };
    const at = (clientX, clientY) => px2ll(tx * tileSize + (clientX - tr.left), ty * tileSize + (clientY - tr.top));
    const center = at(cr.left + cr.width / 2, cr.top + cr.height / 2);
    const nw = at(cr.left, cr.top);
    const se = at(cr.right, cr.bottom);
    return {
      tileZ: z,
      effZoom: +(z + Math.log2(tileSize / 256)).toFixed(3),
      center: [ +center[0].toFixed(4), +center[1].toFixed(4) ],
      nw: [ +nw[0].toFixed(4), +nw[1].toFixed(4) ],
      se: [ +se[0].toFixed(4), +se[1].toFixed(4) ],
      size: [ Math.round(cr.width), Math.round(cr.height) ],
      tileSize: +tileSize.toFixed(1)
    };
  },
  // Scan the Leaflet canvas for painted dots -> cluster centers in client coords.
  dots(step) {
    step = step || 2;
    const canvases = [...document.querySelectorAll('.leaflet-pane canvas')];
    const c = canvases.find(x => x.width > 0);
    if (!c) return { err: 'no canvas' };
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext('2d', { willReadFrequently: true });
    let data;
    try { data = ctx.getImageData(0, 0, c.width, c.height); } catch (e) { return { err: String(e) }; }
    const d = data.data, W = c.width, H = c.height;
    const sx = rect.width / W, sy = rect.height / H;
    const pts = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const a = d[(y * W + x) * 4 + 3];
        if (a > 40) pts.push([x, y]);
      }
    }
    // greedy cluster
    const cell = 9 / Math.min(sx, sy);
    const buckets = new Map();
    for (const [x, y] of pts) {
      const k = Math.floor(x / cell) + ':' + Math.floor(y / cell);
      let b = buckets.get(k);
      if (!b) { b = [0, 0, 0]; buckets.set(k, b); }
      b[0] += x; b[1] += y; b[2] += 1;
    }
    const clusters = [...buckets.values()].map(b => ({
      x: +(rect.left + (b[0] / b[2]) * sx).toFixed(1),
      y: +(rect.top + (b[1] / b[2]) * sy).toFixed(1),
      n: b[2]
    }));
    clusters.sort((a, b) => b.n - a.n);
    return { paintedPixels: pts.length, clusters: clusters.length, top: clusters.slice(0, 40), all: clusters };
  },
  txt(sel) { const e = document.querySelector(sel); return e ? e.textContent.trim().replace(/\\s+/g, ' ') : null; },
  box(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; },
  state() {
    const rail = document.querySelector('input.day-rail');
    return {
      url: location.href,
      masthead: this.txt('.masthead-title'),
      meta: this.txt('.masthead-meta'),
      scrubDate: this.txt('.scrubber-date'),
      scrubFoot: this.txt('.scrubber-foot'),
      indexLine: this.txt('.sighting-index p'),
      mode: (document.querySelector('.segmented[aria-label="Timeline mode"] button[aria-pressed="true"]') || {}).textContent || null,
      rail: rail ? { value: +rail.value, min: +rail.min, max: +rail.max } : null,
      playLabel: (document.querySelector('.play-button') || {}).getAttribute ? document.querySelector('.play-button').getAttribute('aria-label') : null,
      sheet: this.txt('.sighting-sheet h2'),
      sheetPlace: this.txt('.sighting-sheet .sighting-place'),
      sheetOpen: !!document.querySelector('.sighting-sheet'),
      mapNote: this.txt('.map-note'),
      mapEmpty: this.txt('.map-empty h2')
    };
  }
};
`;

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {}
  });
}

async function prep(page) {
  await page.evaluate(HELPERS);
  await page.evaluate(() => window.__ux.killMotion());
}

async function settle(page, ms = 1600) {
  await page.waitForTimeout(ms);
  await prep(page);
}

async function go(page, url, wait = 4000) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  await prep(page);
}

async function shot(page, name) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p });
  log("  shot ->", p);
  return p;
}

// ---------- phases ----------
const phases = {};

phases.fit = async (page) => {
  log("\n=== PHASE fit: ?bird=osprey&region=northeast&days=7 ===");
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await go(page, "/?bird=osprey&region=northeast&days=7", 1500);
  log("t=1.5s", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  await settle(page, 3500);
  const v = await page.evaluate(() => window.__ux.mapView());
  const s = await page.evaluate(() => window.__ux.state());
  log("mapView:", JSON.stringify(v));
  log("state:", JSON.stringify(s, null, 1));
  const d = await page.evaluate(() => window.__ux.dots(2));
  log("dots:", d.err || `painted=${d.paintedPixels} clusters=${d.clusters}`);
  await shot(page, "01-fit-osprey-ne-7d");
  log("console errors:", JSON.stringify(errors));
};

phases.slider = async (page) => {
  log("\n=== PHASE slider ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
  const rows = [];
  for (let i = 0; i <= 6; i++) {
    await page.evaluate((idx) => {
      const rail = document.querySelector("input.day-rail");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(rail, String(idx));
      rail.dispatchEvent(new Event("input", { bubbles: true }));
      rail.dispatchEvent(new Event("change", { bubbles: true }));
    }, i);
    await page.waitForTimeout(500);
    await prep(page);
    const s = await page.evaluate(() => window.__ux.state());
    const d = await page.evaluate(() => window.__ux.dots(2));
    rows.push({ i, rail: s.rail.value, date: s.scrubDate, foot: s.scrubFoot, meta: s.meta, index: s.indexLine, clusters: d.clusters, painted: d.paintedPixels });
    log(JSON.stringify(rows.at(-1)));
  }
  await shot(page, "02-slider-last");
  // now the same in New (daily) mode
  log("--- New mode ---");
  await page.click('.segmented[aria-label="Timeline mode"] button:has-text("New")');
  await page.waitForTimeout(400); await prep(page);
  for (let i = 0; i <= 6; i++) {
    await page.evaluate((idx) => {
      const rail = document.querySelector("input.day-rail");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(rail, String(idx));
      rail.dispatchEvent(new Event("input", { bubbles: true }));
    }, i);
    await page.waitForTimeout(450); await prep(page);
    const s = await page.evaluate(() => window.__ux.state());
    const d = await page.evaluate(() => window.__ux.dots(2));
    log(JSON.stringify({ i, date: s.scrubDate, foot: s.scrubFoot, meta: s.meta, clusters: d.clusters, painted: d.paintedPixels }));
  }
  await shot(page, "03-newmode-day0");
};

phases.play = async (page) => {
  log("\n=== PHASE play ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
  const start = await page.evaluate(() => window.__ux.state());
  log("before play rail=", start.rail.value, "playLabel=", start.playLabel);
  await page.click(".play-button");
  const samples = [];
  for (let t = 0; t < 12; t++) {
    await page.waitForTimeout(450);
    const s = await page.evaluate(() => {
      const rail = document.querySelector("input.day-rail");
      const pb = document.querySelector(".play-button");
      return { rail: rail ? +rail.value : null, label: pb ? pb.getAttribute("aria-label") : null,
               date: document.querySelector(".scrubber-date")?.textContent.trim(),
               foot: document.querySelector(".scrubber-foot")?.textContent.trim().replace(/\s+/g," ") };
    });
    samples.push({ t: (t + 1) * 0.45, ...s });
  }
  samples.forEach((s) => log(JSON.stringify(s)));
  await shot(page, "04-after-play");
  // press play again at the end
  log("--- press play again while parked at end ---");
  const before = await page.evaluate(() => document.querySelector("input.day-rail").value);
  await page.click(".play-button");
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => ({ rail: document.querySelector("input.day-rail").value,
    label: document.querySelector(".play-button").getAttribute("aria-label") }));
  log("rail before:", before, "after replay press:", JSON.stringify(after));
  // stop mid-playback
  log("--- stop mid-playback ---");
  await page.evaluate(() => {
    const rail = document.querySelector("input.day-rail");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(rail, "0"); rail.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.click(".play-button");
  await page.waitForTimeout(1900);
  const mid = await page.evaluate(() => document.querySelector("input.day-rail").value);
  await page.click(".play-button");
  await page.waitForTimeout(1400);
  const stopped = await page.evaluate(() => ({ rail: document.querySelector("input.day-rail").value,
    label: document.querySelector(".play-button").getAttribute("aria-label") }));
  log("mid:", mid, "after pause + 1.4s:", JSON.stringify(stopped));
  // drag while playing
  log("--- drag while playing ---");
  await page.evaluate(() => {
    const rail = document.querySelector("input.day-rail");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(rail, "0"); rail.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click(".play-button");
  await page.waitForTimeout(900);
  const railBox = await page.evaluate(() => window.__ux.box("input.day-rail"));
  await page.mouse.move(railBox.left + 10, railBox.top + railBox.h / 2);
  await page.mouse.down();
  for (let k = 0; k <= 10; k++) {
    await page.mouse.move(railBox.left + (railBox.w * k) / 10, railBox.top + railBox.h / 2);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const afterDrag = await page.evaluate(() => ({ rail: document.querySelector("input.day-rail").value,
    label: document.querySelector(".play-button").getAttribute("aria-label"),
    date: document.querySelector(".scrubber-date").textContent.trim() }));
  log("after drag-while-playing:", JSON.stringify(afterDrag));
  await page.waitForTimeout(1500);
  log("1.5s later:", JSON.stringify(await page.evaluate(() => ({ rail: document.querySelector("input.day-rail").value,
    label: document.querySelector(".play-button").getAttribute("aria-label") }))));
};

phases.record = async (page) => {
  log("\n=== PHASE record ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5500);
  const d = await page.evaluate(() => window.__ux.dots(1));
  log("clusters:", d.clusters, "densest:", JSON.stringify(d.top.slice(0, 6)));
  const targets = d.top.slice(0, 3);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(1500);
    await prep(page);
    const s = await page.evaluate(() => window.__ux.state());
    log(`click #${i} @(${t.x},${t.y}) n=${t.n} ->`, JSON.stringify({ open: s.sheetOpen, name: s.sheet, place: s.sheetPlace }));
    if (i === 0) await shot(page, "05-record-open");
    const detail = await page.evaluate(() => window.__ux.txt(".sighting-details"));
    log("   detail:", detail);
  }
  // close and reopen
  await page.click('.sighting-sheet button[aria-label="Close sighting details"]').catch(() => log("no close btn"));
  await page.waitForTimeout(500);
  log("after close sheetOpen=", await page.evaluate(() => !!document.querySelector(".sighting-sheet")));
  // stale check: open a record, then change the day so that record is no longer plotted
  const t = targets[0];
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(1400); await prep(page);
  log("reopened:", JSON.stringify(await page.evaluate(() => window.__ux.state())).slice(0, 400));
  await page.click('.segmented[aria-label="Timeline mode"] button:has-text("New")');
  await page.evaluate(() => {
    const rail = document.querySelector("input.day-rail");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(rail, "0"); rail.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(900); await prep(page);
  const stale = await page.evaluate(() => window.__ux.state());
  log("after switching to New/day0 with record open:", JSON.stringify({ open: stale.sheetOpen, name: stale.sheet, place: stale.sheetPlace, foot: stale.scrubFoot }));
  await shot(page, "06-record-vs-day0");
  // Escape key
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  log("after Escape sheetOpen=", await page.evaluate(() => !!document.querySelector(".sighting-sheet")));
};

phases.zoom = async (page) => {
  log("\n=== PHASE zoom ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
  log("start:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  const zin = ".leaflet-control-zoom-in";
  const zout = ".leaflet-control-zoom-out";
  log("zoom ctrl box:", JSON.stringify(await page.evaluate(() => window.__ux.box(".leaflet-control-zoom"))));
  log("attribution box:", JSON.stringify(await page.evaluate(() => window.__ux.box(".leaflet-control-attribution"))));
  log("scrubber box:", JSON.stringify(await page.evaluate(() => window.__ux.box(".scrubber"))));
  log("tabbar box:", JSON.stringify(await page.evaluate(() => window.__ux.box(".tab-bar"))));
  for (let i = 0; i < 12; i++) { await page.click(zout, { force: true }); await page.waitForTimeout(220); }
  await page.waitForTimeout(1500); await prep(page);
  log("max out:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  log("  zoom-out disabled?", await page.evaluate(() => document.querySelector(".leaflet-control-zoom-out").className));
  await shot(page, "07-zoom-min");
  for (let i = 0; i < 22; i++) { await page.click(zin, { force: true }); await page.waitForTimeout(200); }
  await page.waitForTimeout(2000); await prep(page);
  log("max in:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  log("  zoom-in disabled?", await page.evaluate(() => document.querySelector(".leaflet-control-zoom-in").className));
  await shot(page, "08-zoom-max");
  // scroll zoom
  const box = await page.evaluate(() => window.__ux.box(".leaflet-container"));
  await page.mouse.move(box.left + box.w / 2, box.top + box.h / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(1200); await prep(page);
  log("after wheel up:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(1400); await prep(page);
  log("after wheel down:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  await shot(page, "09-scrollzoom");
};

phases.crossstate = async (page) => {
  log("\n=== PHASE crossstate ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
  // start playback then switch species
  await page.click(".play-button");
  await page.waitForTimeout(1100);
  log("mid-playback rail:", await page.evaluate(() => document.querySelector("input.day-rail").value));
  await page.goto(BASE + "/?bird=baleag&region=northeast&days=7", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  // instead do in-app switch: reload approach loses the point. Do it properly below.
  await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
  await page.click(".play-button");
  await page.waitForTimeout(1200);
  const preSwitch = await page.evaluate(() => ({ rail: +document.querySelector("input.day-rail").value,
    label: document.querySelector(".play-button").getAttribute("aria-label") }));
  log("pre-switch:", JSON.stringify(preSwitch));
  await page.click(".masthead-title");
  await page.waitForTimeout(700);
  await page.fill(".picker input", "Bald Eagle");
  await page.waitForTimeout(1400);
  const first = await page.evaluate(() => {
    const b = document.querySelector(".picker .catalog button, .picker li button, .picker .species-card");
    return b ? b.textContent.trim().replace(/\s+/g, " ") : null;
  });
  log("first picker result:", first);
  await page.evaluate(() => {
    const b = document.querySelector(".picker .catalog button, .picker li button, .picker .species-card");
    if (b) b.click();
  });
  await page.waitForTimeout(600); await prep(page);
  const during = await page.evaluate(() => window.__ux.state());
  log("immediately after switch:", JSON.stringify({ masthead: during.masthead, meta: during.meta, rail: during.rail, label: during.playLabel, foot: during.scrubFoot, note: during.mapNote }));
  await page.waitForTimeout(5000); await prep(page);
  const after = await page.evaluate(() => window.__ux.state());
  log("5s after switch:", JSON.stringify({ masthead: after.masthead, meta: after.meta, rail: after.rail, label: after.playLabel, foot: after.scrubFoot }));
  log("mapView:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  await shot(page, "10-species-switch-midplay");

  // region switch with record open
  log("--- region switch with record open ---");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5500);
  const d = await page.evaluate(() => window.__ux.dots(1));
  await page.mouse.click(d.top[0].x, d.top[0].y);
  await page.waitForTimeout(1500); await prep(page);
  const rec = await page.evaluate(() => window.__ux.state());
  log("record open:", rec.sheet, "|", rec.sheetPlace);
  // change region via URL-independent control: open menu drawer
  const changed = await page.evaluate(() => {
    // find a region preset button in the app chrome
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim());
    return btns.slice(0, 60);
  });
  log("buttons sample:", JSON.stringify(changed));
};

phases.regionswitch = async (page) => {
  log("\n=== PHASE regionswitch ===");
  await go(page, "/?bird=osprey&region=northeast&days=7", 5500);
  const d = await page.evaluate(() => window.__ux.dots(1));
  await page.mouse.click(d.top[0].x, d.top[0].y);
  await page.waitForTimeout(1600); await prep(page);
  const before = await page.evaluate(() => window.__ux.state());
  log("record:", before.sheet, "|", before.sheetPlace);
  await shot(page, "11a-record-before-region-switch");
  // open the states/menu drawer
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /state|region|menu/i.test(x.getAttribute("aria-label") || x.getAttribute("data-tip") || x.textContent));
    if (b) { b.click(); return (b.getAttribute("aria-label") || b.textContent).trim(); }
    return null;
  });
  log("opened control:", opened);
  await page.waitForTimeout(900); await prep(page);
  const presetBtns = await page.evaluate(() => [...document.querySelectorAll(".drawer button, .sheet button, [role=dialog] button")].map((b) => b.textContent.trim().replace(/\s+/g, " ")).slice(0, 50));
  log("drawer buttons:", JSON.stringify(presetBtns));
  await shot(page, "11b-region-drawer");
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "California" || x.textContent.trim() === "West Coast" || x.textContent.trim() === "Pacific");
    if (b) { b.click(); return b.textContent.trim(); }
    return null;
  });
  log("region clicked:", clicked);
  await page.waitForTimeout(1200); await prep(page);
  const mid = await page.evaluate(() => window.__ux.state());
  log("right after region change:", JSON.stringify({ sheetOpen: mid.sheetOpen, sheet: mid.sheet, place: mid.sheetPlace, meta: mid.meta, foot: mid.scrubFoot }));
  await page.waitForTimeout(6000); await prep(page);
  const after = await page.evaluate(() => window.__ux.state());
  log("6s later:", JSON.stringify({ sheetOpen: after.sheetOpen, sheet: after.sheet, place: after.sheetPlace, meta: after.meta, foot: after.scrubFoot, empty: after.mapEmpty }));
  log("mapView:", JSON.stringify(await page.evaluate(() => window.__ux.mapView())));
  await shot(page, "11c-record-after-region-switch");
};

phases.windows = async (page) => {
  log("\n=== PHASE windows ===");
  for (const url of [
    "/?bird=osprey&region=northeast&days=1",
    "/?bird=osprey&region=northeast&days=30",
    "/?bird=amerob&region=nationwide&days=1",
    "/?bird=kirwar&region=nationwide&days=30",
    "/?bird=ivbwoo&region=nationwide&days=30"
  ]) {
    await go(page, url, 7000);
    const s = await page.evaluate(() => window.__ux.state());
    const v = await page.evaluate(() => window.__ux.mapView());
    const d = await page.evaluate(() => window.__ux.dots(2));
    log(url);
    log("  ", JSON.stringify({ masthead: s.masthead, meta: s.meta, rail: s.rail, date: s.scrubDate, foot: s.scrubFoot, empty: s.mapEmpty, note: s.mapNote }));
    log("   view:", JSON.stringify(v), "dots:", d.err || d.clusters);
    const histo = await page.evaluate(() => {
      const bars = [...document.querySelectorAll(".histogram button")];
      return { n: bars.length, widths: bars.slice(0, 3).map((b) => +b.getBoundingClientRect().width.toFixed(2)),
               labels: bars.slice(0, 2).map((b) => b.getAttribute("aria-label")) };
    });
    log("   histogram:", JSON.stringify(histo));
    await shot(page, "12-" + url.replace(/[^a-z0-9]+/gi, "_").slice(0, 50));
  }
};

phases.mobile = async (page, context) => {
  log("\n=== PHASE mobile 375x667 ===");
  await page.setViewportSize({ width: 375, height: 667 });
  await go(page, "/?bird=osprey&region=northeast&days=7", 6000);
  const boxes = await page.evaluate(() => {
    const sels = [".leaflet-control-zoom", ".leaflet-control-attribution", ".scrubber", ".tab-bar", ".masthead", ".topbar", ".histogram", "input.day-rail", ".scrubber-foot", ".play-button", ".ramp-key"];
    const out = {};
    for (const s of sels) out[s] = window.__ux.box(s);
    out.__vp = { w: innerWidth, h: innerHeight };
    return out;
  });
  log(JSON.stringify(boxes, null, 1));
  await shot(page, "13-mobile-map");
  const d = await page.evaluate(() => window.__ux.dots(1));
  log("dots:", d.err || d.clusters);
  if (d.top && d.top.length) {
    await page.mouse.click(d.top[0].x, d.top[0].y);
    await page.waitForTimeout(1800); await prep(page);
    const s = await page.evaluate(() => window.__ux.state());
    log("record on mobile:", JSON.stringify({ open: s.sheetOpen, name: s.sheet }));
    const rb = await page.evaluate(() => {
      const out = {};
      for (const sel of [".sighting-sheet", ".scrubber", ".tab-bar", ".leaflet-control-zoom", ".sighting-sheet footer"]) out[sel] = window.__ux.box(sel);
      out.scrollable = (() => { const e = document.querySelector(".sighting-sheet"); return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null; })();
      return out;
    });
    log("mobile boxes with sheet:", JSON.stringify(rb, null, 1));
    await shot(page, "14-mobile-record");
  }
  // landscape phone
  log("--- landscape 667x375 ---");
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(1500); await prep(page);
  const lb = await page.evaluate(() => {
    const out = {};
    for (const sel of [".sighting-sheet", ".scrubber", ".tab-bar", ".leaflet-control-zoom", ".masthead", ".topbar"]) out[sel] = window.__ux.box(sel);
    out.__vp = { w: innerWidth, h: innerHeight };
    return out;
  });
  log(JSON.stringify(lb, null, 1));
  await shot(page, "15-landscape");
};

phases.breakpoints = async (page) => {
  log("\n=== PHASE breakpoints ===");
  for (const [w, h] of [[419, 800], [420, 800], [519, 800], [520, 800], [860, 800], [861, 800], [320, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, "/?bird=osprey&region=northeast&days=7", 5000);
    const b = await page.evaluate(() => {
      const out = {};
      for (const sel of [".scrubber", ".tab-bar", ".leaflet-control-zoom", ".scrubber-head", ".scrubber-foot", ".ramp-key", ".histogram", ".leaflet-control-attribution"]) out[sel] = window.__ux.box(sel);
      const foot = document.querySelector(".scrubber-foot");
      out.footOverflow = foot ? { sw: foot.scrollWidth, cw: foot.clientWidth } : null;
      const head = document.querySelector(".scrubber-head");
      out.headOverflow = head ? { sw: head.scrollWidth, cw: head.clientWidth } : null;
      out.bodyOverflow = { sw: document.body.scrollWidth, cw: document.body.clientWidth };
      return out;
    });
    log(`${w}x${h}:`, JSON.stringify(b));
    await shot(page, `16-bp-${w}`);
  }
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => log("PAGEERROR:", e.message));
  await boot(page);
  const list = PHASE === "all" ? Object.keys(phases) : PHASE.split(",");
  for (const p of list) {
    if (!phases[p]) { log("no phase", p); continue; }
    try { await phases[p](page, context); } catch (e) { log("PHASE " + p + " threw:", e.message); }
  }
  await browser.close();
})();
