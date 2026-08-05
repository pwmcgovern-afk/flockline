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
    catch { console.log("  retry goto", i); await page.waitForTimeout(3000); }
  }
  throw new Error("goto failed " + url);
}
async function boot(browser, { width = 1440, height = 900, url = "/", mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" } : {})
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
  await goto(page, url);
  await page.evaluate(() => localStorage.setItem("flockline.tourSeen.v2", "1"));
  await goto(page, url);
  await page.waitForTimeout(2500);
  await freeze(page);
  return { ctx, page };
}
const rects = (page, sels) =>
  page.evaluate((list) =>
    list.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { s, missing: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { s, r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], z: cs.zIndex, pos: cs.position, disp: cs.display, vis: cs.visibility, text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 60) };
    }), sels);

const browser = await chromium.launch();

// ---------- PHASE 16: mobile chrome collisions ----------
console.log("\n=== PHASE 16: 375x667 drawer chrome ===");
{
  const { ctx, page } = await boot(browser, { width: 375, height: 667, mobile: true });
  await page.evaluate(() => localStorage.setItem("flockline.watchlist.v1", JSON.stringify(["osprey", "baleag", "comloo", "rthhum", "scatan", "balori"])));
  await goto(page, "/");
  await page.waitForTimeout(2500);
  await page.click("button.tab-birds");
  await page.waitForTimeout(900);
  await freeze(page);
  console.log(JSON.stringify(await rects(page, [".drawer-foot", ".leaflet-control-attribution", "aside", ".tabbar", "nav", ".drawer-body", ".watch-add"]), null, 1));
  // what is on top at the attribution point
  console.log("elementFromPoint at attribution:", await page.evaluate(() => {
    const a = document.querySelector(".leaflet-control-attribution");
    const r = a.getBoundingClientRect();
    const e = document.elementFromPoint(r.x + r.width - 8, r.y + r.height / 2);
    return e ? e.className + " | " + e.tagName : null;
  }));
  await page.screenshot({ path: `${SHOTS}/34-m-birds-six.png` });

  // Escape
  console.log("-- Escape --");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await freeze(page);
  console.log("drawer after esc:", await page.evaluate(() => !!document.querySelector("aside .watch-list")));
  console.log("focus after esc:", await page.evaluate(() => document.activeElement?.className + " | " + (document.activeElement?.innerText || "").slice(0, 30)));
  console.log("URL after esc:", page.url());

  // tab order / trap when drawer open
  await page.click("button.tab-birds");
  await page.waitForTimeout(700);
  await freeze(page);
  const order = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return "none";
      const r = a.getBoundingClientRect();
      return `${a.tagName}.${(a.className || "").toString().slice(0, 26)} "${(a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 22)}" y=${Math.round(r.y)} h=${Math.round(r.height)}`;
    }));
  }
  console.log("tab order:\n  " + order.join("\n  "));
  await ctx.close();
}

// ---------- PHASE 17: back button ----------
console.log("\n=== PHASE 17: back button ===");
{
  const { ctx, page } = await boot(browser, { width: 375, height: 667, mobile: true });
  const start = page.url();
  await page.click("button.tab-birds");
  await page.waitForTimeout(700);
  console.log("after open:", page.url());
  await page.goBack({ waitUntil: "domcontentloaded" }).catch((e) => console.log("  goBack:", String(e).slice(0, 80)));
  await page.waitForTimeout(2000);
  console.log("after back URL:", page.url());
  console.log("still on flockline?", page.url().includes("flockline"));
  console.log("drawer open?", await page.evaluate(() => !!document.querySelector("aside")));
  await ctx.close();
}

// ---------- PHASE 18: landscape / short viewport ----------
console.log("\n=== PHASE 18: 740x420 landscape ===");
{
  const { ctx, page } = await boot(browser, { width: 740, height: 420, mobile: true });
  await page.evaluate(() => localStorage.setItem("flockline.watchlist.v1", JSON.stringify(["osprey", "baleag", "comloo", "rthhum", "scatan", "balori"])));
  await goto(page, "/");
  await page.waitForTimeout(2500);
  await page.click("button.tab-birds");
  await page.waitForTimeout(900);
  await freeze(page);
  console.log(JSON.stringify(await rects(page, ["aside", ".drawer-body", ".drawer-foot", ".watch-add", ".leaflet-control-attribution"]), null, 1));
  console.log("scroll:", await page.evaluate(() => { const e = document.querySelector(".drawer-body"); return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null; }));
  await page.screenshot({ path: `${SHOTS}/35-landscape-birds.png` });
  await ctx.close();
}

// ---------- PHASE 19: 419 vs 420 ----------
for (const w of [360, 419, 420, 520, 860, 861]) {
  const { ctx, page } = await boot(browser, { width: w, height: 800, mobile: w < 861 });
  await page.evaluate(() => localStorage.setItem("flockline.watchlist.v1", JSON.stringify(["osprey", "baleag"])));
  await goto(page, "/");
  await page.waitForTimeout(2200);
  await page.click("button.tab-birds");
  await page.waitForTimeout(800);
  await freeze(page);
  const info = await page.evaluate(() => {
    const rowEls = Array.from(document.querySelectorAll(".watch-row"));
    return {
      rows: rowEls.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      clipped: rowEls.map((e) => { const b = e.querySelector(".pick strong"); return b ? b.scrollWidth > b.clientWidth : null; })
    };
  });
  console.log(`w=${w}`, JSON.stringify(info));
  await page.screenshot({ path: `${SHOTS}/36-w${w}.png` });
  await ctx.close();
}

await browser.close();
