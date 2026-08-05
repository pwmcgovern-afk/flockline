import { launch, page, settle, view, project, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);
let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) { try { payload = await r.json(); } catch {} }
});

const geom = () => p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const hit = (s) => {
    const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { reachable: e === top || e.contains(top), topEl: top ? (top.tagName + "." + (top.className || "").toString().split(" ")[0]) : null };
  };
  const overlap = (a, b) => {
    const A = document.querySelector(a), B = document.querySelector(b);
    if (!A || !B) return null;
    const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
    const ox = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
    const oy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
    return { overlapW: Math.round(ox), overlapH: Math.round(oy) };
  };
  return {
    sheet: r("aside.sighting-sheet"),
    scrubber: r(".scrubber"),
    play: r(".play-button"),
    playHit: hit(".play-button"),
    scrubDate: r(".scrubber-date"),
    scrubDateHit: hit(".scrubber-date"),
    hist: r(".histogram"),
    firstBar: r(".histogram button"),
    firstBarHit: hit(".histogram button"),
    rail: r("input.day-rail"),
    railHit: hit("input.day-rail"),
    foot: r(".scrubber-foot"),
    tabbar: r(".tab-bar"),
    zoomIn: r(".leaflet-control-zoom-in"),
    zoomInHit: hit(".leaflet-control-zoom-in"),
    zoomOut: r(".leaflet-control-zoom-out"),
    attribution: r(".leaflet-control-attribution"),
    sheetVsScrubber: overlap("aside.sighting-sheet", ".scrubber"),
    sheetVsTabbar: overlap("aside.sighting-sheet", ".tab-bar"),
    vw: innerWidth, vh: innerHeight
  };
});

async function openRecord(pg) {
  const v = await view(pg);
  const feats = payload.featureCollection.features;
  for (const f of feats) {
    const [lng, lat] = f.geometry.coordinates;
    const s = await project(pg, lat, lng);
    if (s && s.x > 40 && s.x < v.container.w - 40 && s.y > v.container.y + 40 && s.y < v.container.y + v.container.h - 200) {
      await pg.mouse.click(s.x, s.y);
      await pg.waitForTimeout(600);
      await killMotion(pg);
      const ok = await pg.locator("aside.sighting-sheet").count();
      if (ok) return f.properties.locName;
    }
  }
  return null;
}

for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 860 }, { w: 1024, h: 800 }, { w: 900, h: 800 }, { w: 861, h: 800 }, { w: 860, h: 800 }, { w: 768, h: 900 }, { w: 520, h: 800 }, { w: 420, h: 800 }, { w: 375, h: 667 }, { w: 320, h: 640 }]) {
  await p.setViewportSize({ width: vp.w, height: vp.h });
  await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
  await waitForData(p, 40000);
  await settle(p, 1200);
  const before = await geom();
  const name = await openRecord(p);
  await settle(p, 400);
  const after = await geom();
  console.log(`\n### ${vp.w}x${vp.h}  record="${name}"`);
  console.log("  closed: scrubber", JSON.stringify(before.scrubber), "play", JSON.stringify(before.play), "playHit", JSON.stringify(before.playHit));
  console.log("  open:   sheet", JSON.stringify(after.sheet));
  console.log("          scrubber", JSON.stringify(after.scrubber));
  console.log("          overlap sheet/scrubber", JSON.stringify(after.sheetVsScrubber), " sheet/tabbar", JSON.stringify(after.sheetVsTabbar));
  console.log("          playHit", JSON.stringify(after.playHit), " railHit", JSON.stringify(after.railHit), " barHit", JSON.stringify(after.firstBarHit), " dateHit", JSON.stringify(after.scrubDateHit));
  console.log("          zoomIn", JSON.stringify(after.zoomIn), "hit", JSON.stringify(after.zoomInHit), " attribution", JSON.stringify(after.attribution));
  console.log("          tabbar", JSON.stringify(after.tabbar));
  if (name) await p.screenshot({ path: `${SHOTS}/06-record-${vp.w}x${vp.h}.png` });
}

await browser.close();
