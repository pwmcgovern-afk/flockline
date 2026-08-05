import { chromium } from "playwright";

const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/shots";
const BASE = "https://flockline.app";
const KILL = `*, *::before, *::after { transition: none !important; animation: none !important; }`;

async function freeze(page) {
  await page.addStyleTag({ content: KILL });
  await page.evaluate(() => document.body.getBoundingClientRect().height);
}
async function goto(page, url) {
  for (let i = 0; i < 4; i++) {
    try { await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 }); return; }
    catch { console.log("  retry", i); await page.waitForTimeout(3000); }
  }
  throw new Error("goto failed");
}

const browser = await chromium.launch();

// precise text-line geometry: does the attribution sit on top of footer text?
console.log("\n=== PHASE 30: exact footer-vs-attribution geometry (375x667) ===");
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); localStorage.setItem("flockline.watchlist.v1", JSON.stringify(["osprey", "baleag"])); } catch {} });
  const page = await ctx.newPage();
  await goto(page, "/?view=birds");
  await page.waitForTimeout(4000);
  await freeze(page);
  const geo = await page.evaluate(() => {
    const foot = document.querySelector(".drawer-foot");
    const range = document.createRange();
    range.selectNodeContents(foot);
    const lines = Array.from(range.getClientRects()).map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]);
    const attr = document.querySelector(".leaflet-control-attribution");
    const ar = attr.getBoundingClientRect();
    const arect = [Math.round(ar.x), Math.round(ar.y), Math.round(ar.width), Math.round(ar.height)];
    const overlapsAny = lines.some((l) => !(l[0] + l[2] <= arect[0] || l[0] >= arect[0] + arect[2] || l[1] + l[3] <= arect[1] || l[1] >= arect[1] + arect[3]));
    const cs = getComputedStyle(attr);
    return { footerTextLines: lines, attribution: arect, overlapsAny, attrBg: cs.backgroundColor, attrZ: cs.zIndex };
  });
  console.log(JSON.stringify(geo, null, 1));
  await page.screenshot({ path: `${SHOTS}/44-m-footer-attribution.png` });

  // and at 419 / 520 / 860 (bottom sheet range)
  for (const w of [419, 520, 860]) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(800);
    await freeze(page);
    const g = await page.evaluate(() => {
      const foot = document.querySelector(".drawer-foot");
      if (!foot) return null;
      const range = document.createRange();
      range.selectNodeContents(foot);
      const lines = Array.from(range.getClientRects()).map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]);
      const attr = document.querySelector(".leaflet-control-attribution").getBoundingClientRect();
      const arect = [Math.round(attr.x), Math.round(attr.y), Math.round(attr.width), Math.round(attr.height)];
      const ov = lines.some((l) => !(l[0] + l[2] <= arect[0] || l[0] >= arect[0] + arect[2] || l[1] + l[3] <= arect[1] || l[1] >= arect[1] + arect[3]));
      return { w: window.innerWidth, lines: lines.slice(-2), attr: arect, ov };
    });
    console.log(JSON.stringify(g));
  }
  await ctx.close();
}

await browser.close();
