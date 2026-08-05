import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/phones";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "https://flockline.app";

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "812x375L", width: 812, height: 375 },
  { name: "667x375L", width: 667, height: 375 },
];

const FREEZE = () => {
  let s = document.getElementById("__freeze");
  if (!s) {
    s = document.createElement("style");
    s.id = "__freeze";
    s.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}";
    document.head.appendChild(s);
  }
  document.body.getBoundingClientRect();
  return true;
};

async function freeze(page) {
  await page.evaluate(FREEZE);
  await page.waitForTimeout(80);
}

const GEO = () => {
  const vw = innerWidth, vh = innerHeight;
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom), z: cs.zIndex };
  };
  const overlap = (a, c) => {
    if (!a || !c) return 0;
    const x = Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x));
    const y = Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
    return Math.round(x * y);
  };
  const out = {
    vw, vh,
    topbar: r(".topbar"),
    map: r(".map-canvas"),
    scrubber: r(".scrubber"),
    tabbar: r(".tab-bar"),
    drawer: r(".drawer"),
    sheet: r(".sighting-sheet"),
    picker: r(".picker"),
    chrome: r(".chrome"),
  };
  out.overlap_sheet_scrubber = overlap(out.sheet, out.scrubber);
  out.overlap_sheet_tabbar = overlap(out.sheet, out.tabbar);
  out.overlap_drawer_tabbar = overlap(out.drawer, out.tabbar);
  out.overlap_scrubber_tabbar = overlap(out.scrubber, out.tabbar);
  out.tabHits = [];
  for (const sel of [".tab-map", ".tab-insights", ".tab-ask", ".tab-birds"]) {
    const el = document.querySelector(sel);
    if (!el) { out.tabHits.push({ sel, missing: true }); continue; }
    const b = el.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const inside = hit ? (el.contains(hit) || hit === el) : false;
    out.tabHits.push({
      sel,
      rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      onscreen: b.y >= 0 && b.bottom <= vh + 0.5,
      hitReachable: inside,
      hitEl: hit ? (hit.tagName.toLowerCase() + "." + String(hit.className).split(" ").slice(0,2).join(".")) : null,
    });
  }
  out.offscreenBottom = [];
  for (const sel of [".scrubber", ".tab-bar", ".sighting-sheet", ".drawer", ".picker", ".tour-card", ".drawer-foot", ".picker-foot"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    if (b.height < 1) continue;
    if (b.bottom > vh + 1) out.offscreenBottom.push({ sel, bottom: Math.round(b.bottom), vh, over: Math.round(b.bottom - vh) });
    if (b.top < -1) out.offscreenBottom.push({ sel, top: Math.round(b.top), note: "above viewport" });
  }
  out.overflowX = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (el.closest(".leaflet-pane") || el.closest(".leaflet-control-container") || el.classList.contains("leaflet-container")) continue;
    if (el.closest(".sighting-index")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    if (b.right > vw + 1 || b.left < -1) {
      out.overflowX.push({
        el: el.tagName.toLowerCase() + "." + String(el.className).split(" ").slice(0,3).join("."),
        left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      });
    }
  }
  return out;
};

async function geo(page) { return await page.evaluate(GEO); }
async function shot(page, name) { const p = `${OUT}/${name}.png`; await page.screenshot({ path: p }); return p; }

const log = [];
function say(...a) { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); }

async function ctxFor(browser, vp, { tour = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  if (!tour) await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch (e) {} });
  return ctx;
}

async function run() {
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    say(`\n########## ${vp.name} ##########`);
    const ctx = await ctxFor(browser, vp);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?bird=amerob&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6500);
    await freeze(page);

    const base = await geo(page);
    say("BASE geo:", JSON.stringify({
      topbar: base.topbar, map: base.map, scrubber: base.scrubber, tabbar: base.tabbar,
      overlap_scrubber_tabbar: base.overlap_scrubber_tabbar,
      offscreenBottom: base.offscreenBottom, overflowX: base.overflowX,
    }));
    if (base.topbar && base.scrubber) {
      const band = base.scrubber.y - base.topbar.b;
      say(`MAP unobstructed band (topbar bottom -> scrubber top): ${band}px of ${vp.height} (${Math.round(band/vp.height*100)}%)`);
    }

    for (const [tab, sel] of [["insights", ".tab-insights"], ["ask", ".tab-ask"], ["birds", ".tab-birds"]]) {
      await page.click(sel);
      await page.waitForTimeout(1000);
      await freeze(page);
      const g = await geo(page);
      say(`DRAWER ${tab}:`, JSON.stringify({
        drawer: g.drawer, tabbar: g.tabbar, overlap_drawer_tabbar: g.overlap_drawer_tabbar,
        tabHits: g.tabHits, offscreenBottom: g.offscreenBottom, overflowX: g.overflowX.slice(0, 6),
      }));
      await shot(page, `${vp.name}-drawer-${tab}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => !!document.querySelector(".drawer"));
      say(`  Escape closed drawer: ${!after}`);
      if (after) { await page.click(".drawer-head button[aria-label^='Close']").catch(() => {}); await page.waitForTimeout(400); }
    }

    await page.click(".masthead-title");
    await page.waitForTimeout(800);
    await freeze(page);
    const gp = await geo(page);
    say("PICKER:", JSON.stringify({ picker: gp.picker, offscreenBottom: gp.offscreenBottom, overflowX: gp.overflowX.slice(0, 6) }));
    await shot(page, `${vp.name}-picker`);
    const pinfo = await page.evaluate(() => {
      const p = document.querySelector(".picker");
      if (!p) return null;
      const res = p.querySelector(".picker-results");
      const inp = p.querySelector("input");
      return {
        pickerH: Math.round(p.getBoundingClientRect().height),
        resultsH: res ? Math.round(res.getBoundingClientRect().height) : null,
        resultsScrollH: res ? res.scrollHeight : null,
        resultsOverflow: res ? getComputedStyle(res).overflowY : null,
        inputH: inp ? Math.round(inp.getBoundingClientRect().height) : null,
        inputFont: inp ? getComputedStyle(inp).fontSize : null,
        tabsScroll: (() => { const t = p.querySelector(".picker-tabs"); return t ? { w: Math.round(t.getBoundingClientRect().width), sw: t.scrollWidth, ox: getComputedStyle(t).overflowX } : null; })(),
        firstResults: Array.from(p.querySelectorAll(".picker-results button")).slice(0, 3).map(b => b.textContent.trim().slice(0, 30)),
      };
    });
    say("  picker internals:", JSON.stringify(pinfo));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    say("  Escape closed picker:", String(!(await page.evaluate(() => !!document.querySelector(".picker")))));

    const opened = await page.evaluate(() => {
      const b = document.querySelector(".sighting-index button");
      if (!b) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(1600);
    await freeze(page);
    if (opened) {
      const gs = await geo(page);
      say("SIGHTING SHEET:", JSON.stringify({
        sheet: gs.sheet, scrubber: gs.scrubber, tabbar: gs.tabbar,
        overlap_sheet_scrubber: gs.overlap_sheet_scrubber,
        overlap_sheet_tabbar: gs.overlap_sheet_tabbar,
        offscreenBottom: gs.offscreenBottom,
      }));
      const sheetInfo = await page.evaluate(() => {
        const s = document.querySelector(".sighting-sheet");
        if (!s) return null;
        const b = s.getBoundingClientRect();
        const scrub = document.querySelector(".scrubber");
        const sb = scrub ? scrub.getBoundingClientRect() : null;
        const scrubHit = sb ? document.elementFromPoint(sb.x + sb.width / 2, sb.y + 20) : null;
        const tb = document.querySelector(".tab-bar");
        const tbb = tb ? tb.getBoundingClientRect() : null;
        const tabHit = tbb ? document.elementFromPoint(tbb.x + tbb.width / 2, tbb.y + tbb.height / 2) : null;
        return {
          sheetScrollH: s.scrollHeight, sheetClientH: s.clientHeight,
          overflowY: getComputedStyle(s).overflowY,
          scrubHit: scrubHit ? scrubHit.tagName + "." + String(scrubHit.className).slice(0, 30) : null,
          tabHit: tabHit ? tabHit.tagName + "." + String(tabHit.className).slice(0, 30) : null,
        };
      });
      say("  sheet internals:", JSON.stringify(sheetInfo));
      await shot(page, `${vp.name}-sighting`);
    } else {
      say("SIGHTING SHEET: could not open");
    }
    await ctx.close();
  }

  for (const vp of VIEWPORTS) {
    const ctx = await ctxFor(browser, vp, { tour: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await freeze(page);
    const t = await page.evaluate(() => {
      const card = document.querySelector(".tour-card") || document.querySelector("[class*='tour']:not(button)");
      if (!card) return null;
      const b = card.getBoundingClientRect();
      return {
        cls: card.className,
        rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) },
        vw: innerWidth, vh: innerHeight,
        text: (card.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
        buttons: Array.from(card.querySelectorAll("button")).map(x => {
          const bb = x.getBoundingClientRect();
          return { t: (x.textContent.trim().slice(0, 20) || x.getAttribute("aria-label")), w: Math.round(bb.width), h: Math.round(bb.height), y: Math.round(bb.y), b: Math.round(bb.bottom) };
        }),
      };
    });
    say(`\nTOUR ${vp.name}:`, JSON.stringify(t));
    await shot(page, `${vp.name}-tour`);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(`${OUT}/pass2.txt`, log.join("\n"));
}

run().catch((e) => { console.error(e); process.exit(1); });
