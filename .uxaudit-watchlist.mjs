import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://flockline.app";
const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/wl-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const KILL = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
async function freeze(page) { await page.addStyleTag({ content: KILL }).catch(() => {}); await page.evaluate(() => document.body.offsetHeight); await page.waitForTimeout(150); }
async function shot(page, name, clip) { await freeze(page); const p = `${SHOTS}/${name}.png`; await page.screenshot({ path: p, ...(clip ? { clip } : {}) }); return p; }
async function newCtx(browser, { width = 375, height = 667, ls = null, mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
  if (ls) await ctx.addInitScript((pairs) => { try { for (const [k, v] of pairs) localStorage.setItem(k, v); } catch {} }, Object.entries(ls));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
  return { ctx, page };
}
const log = (...a) => console.log(...a);
const browser = await chromium.launch();

log("\n########## P10: MOBILE TAB BAR OCCLUSION WHILE MY BIRDS IS OPEN ##########");
for (const [w, h] of [[375, 667], [390, 844], [360, 640], [414, 896]]) {
  const { ctx, page } = await newCtx(browser, { width: w, height: h, ls: { "flockline.watchlist.v1": JSON.stringify(["osprey","baleag"]) } });
  await page.goto(`${BASE}/?states=US-CT&days=7&view=birds`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000); await freeze(page);
  const probe = await page.evaluate(() => {
    const r = (el) => el ? (({ x, y, width, height, top, bottom }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height), top: Math.round(top), bottom: Math.round(bottom) }))(el.getBoundingClientRect()) : null;
    const tabs = [...document.querySelectorAll(".tab-bar button")];
    const out = tabs.map((b) => {
      const rect = b.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        tab: b.className.trim(),
        rect: r(b),
        hitTag: hit ? hit.tagName + "." + (typeof hit.className === "string" ? hit.className : "") : null,
        reachesTab: hit ? (hit === b || b.contains(hit)) : false,
      };
    });
    const attrib = document.querySelector(".leaflet-control-attribution");
    return {
      tabs: out,
      tabbar: r(document.querySelector(".tab-bar")),
      drawer: r(document.querySelector(".drawer")),
      foot: r(document.querySelector(".drawer-foot")),
      tabbarZ: getComputedStyle(document.querySelector(".tab-bar")).zIndex,
      drawerZ: getComputedStyle(document.querySelector(".drawer")).zIndex,
      tabbarVisible: getComputedStyle(document.querySelector(".tab-bar")).visibility,
      tabbarOpacity: getComputedStyle(document.querySelector(".tab-bar")).opacity,
      attribution: r(attrib),
      attributionZ: attrib ? getComputedStyle(attrib).zIndex : null,
      attributionText: attrib ? attrib.innerText : null,
      footRect: r(document.querySelector(".drawer-foot")),
      vh: innerHeight,
    };
  });
  log(`\n--- ${w}x${h} ---`);
  log(JSON.stringify(probe, null, 1));
  log("shot:", await shot(page, `80-m-${w}x${h}-birds-open`));
  // Try actually clicking the Insights tab while the drawer is open
  const before = page.url();
  await page.locator(".tab-bar button.tab-insights").click({ timeout: 5000 }).catch((e) => log("  click failed:", String(e).slice(0, 120)));
  await page.waitForTimeout(1200); await freeze(page);
  log("URL before:", before, "| after clicking Insights tab:", page.url());
  log("drawer aria-label now:", await page.locator(".drawer").getAttribute("aria-label").catch(() => "-"));
  log("shot:", await shot(page, `81-m-${w}x${h}-after-tab-click`));
  await ctx.close();
}

await browser.close();
log("\nDONE G");
