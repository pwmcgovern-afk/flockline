import { chromium } from "playwright";

const SHOTS = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/shots";
const BASE = "https://flockline.app";
const KILL_ANIM = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
const log = (...a) => console.log(...a);
async function newCtx(browser, size) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
  return ctx;
}
async function freeze(page) {
  await page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
  await page.evaluate(() => document.body.offsetHeight);
}
const waitCards = (page, t = 120000) =>
  page.waitForFunction(() => document.querySelectorAll(".insight-card").length > 0, null, { timeout: t });

const browser = await chromium.launch();

// ---------- T14: mobile - is the tab bar reachable with Insights open?
log("\n=== T14: mobile tab bar reachability with Insights open ===");
{
  const c = await newCtx(browser, { width: 375, height: 667 });
  const p = await c.newPage();
  await p.goto(`${BASE}/?view=insights&region=northeast`, { waitUntil: "domcontentloaded" });
  await freeze(p);
  await waitCards(p).catch(() => {});
  await freeze(p);
  const askTab = await p.$(".tab-bar button:has-text('ASK')");
  log("ASK tab exists:", Boolean(askTab));
  if (askTab) {
    const b = await askTab.boundingBox();
    log("ASK tab box:", b);
    const over = await p.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName}.${String(e.className).slice(0, 50)}` : null;
    }, [b.x + b.width / 2, b.y + b.height / 2]);
    log("element at ASK tab centre:", over);
    try {
      await askTab.click({ timeout: 3000 });
      log("click succeeded; drawer now:", await p.evaluate(() => document.querySelector(".drawer-head h2, .drawer h2")?.innerText));
    } catch (e) {
      log("CLICK BLOCKED:", e.message.split("\n")[0]);
    }
  }
  // clip the bottom band to show the collision
  await p.screenshot({ path: `${SHOTS}/t14-mobile-bottomband.png`, clip: { x: 0, y: 590, width: 375, height: 77 } });
  await c.close();
}

// ---------- T15: skip link while Insights is open
log("\n=== T15: 'Skip to controls' while Insights is open ===");
{
  const c = await newCtx(browser, { width: 1400, height: 900 });
  const p = await c.newPage();
  await p.goto(`${BASE}/?view=insights&region=northeast`, { waitUntil: "domcontentloaded" });
  await freeze(p);
  await waitCards(p).catch(() => {});
  log("before:", await p.evaluate(() => document.querySelector(".drawer h2")?.innerText), "| url:", p.url());
  await p.keyboard.press("Tab");
  log("focused:", await p.evaluate(() => document.activeElement?.innerText));
  await p.keyboard.press("Enter");
  await p.waitForTimeout(800);
  await freeze(p);
  log("after :", await p.evaluate(() => document.querySelector(".drawer h2")?.innerText), "| url:", p.url());
  log("cards now:", await p.evaluate(() => document.querySelectorAll(".insight-card").length));
  await p.screenshot({ path: `${SHOTS}/t15-skiplink.png` });
  await c.close();
}

// ---------- T16: contrast sampling inside the insights drawer
log("\n=== T16: contrast ===");
{
  const c = await newCtx(browser, { width: 1400, height: 900 });
  const p = await c.newPage();
  await p.goto(`${BASE}/?view=insights&region=northeast`, { waitUntil: "domcontentloaded" });
  await freeze(p);
  await waitCards(p).catch(() => {});
  await freeze(p);
  const res = await p.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      let e = el;
      while (e) {
        const bg = getComputedStyle(e).backgroundColor;
        const m = parse(bg);
        const a = (bg.match(/[\d.]+/g) || [])[3];
        if (m.length === 3 && (a === undefined || Number(a) > 0.5)) return m;
        e = e.parentElement;
      }
      return [255, 255, 255];
    };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1]; return (x + 0.05) / (y + 0.05); };
    const targets = [
      [".insights-scope .scope-note span", "scope note"],
      [".insight-card .insight-kind", "kind label"],
      [".insight-card h3", "card title"],
      [".insight-card p", "card body"],
      [".insight-card .insight-meta span", "card region"],
      [".insight-card .insight-meta button", "view on map"],
      [".insight-card .insight-meta a", "checklist link"],
      [".drawer-foot", "footer"],
      [".insights-scope .segmented button:not(.active)", "window pill inactive"],
      [".insights-scope .segmented button.active", "window pill active"],
      [".scope-select", "region select"],
      [".field-hint", "field hint"]
    ];
    return targets.map(([sel, name]) => {
      const el = document.querySelector(sel);
      if (!el) return { name, missing: true };
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = bgOf(el);
      return {
        name, fg: cs.color, bg: `rgb(${bg.join(",")})`,
        size: cs.fontSize, weight: cs.fontWeight,
        ratio: Math.round(ratio(fg, bg) * 100) / 100,
        text: el.innerText.replace(/\s+/g, " ").slice(0, 40)
      };
    });
  });
  for (const r of res) log(" ", JSON.stringify(r));
  await c.close();
}

// ---------- T17: does 7D vs 30D actually change the payload?
log("\n=== T17: API payload sanity across windows ===");
{
  const c = await newCtx(browser, { width: 1400, height: 900 });
  const p = await c.newPage();
  await p.goto(`${BASE}/?view=map`, { waitUntil: "domcontentloaded" });
  for (const back of [1, 7, 30]) {
    const out = await p.evaluate(async (b) => {
      const r = await fetch(`/api/insights?back=${b}&regions=US-CT,US-RI`);
      const d = await r.json();
      return { status: r.status, back: d.back, scopeLabel: d.scopeLabel, n: d.findings?.length, gen: d.generator, titles: (d.findings || []).map((f) => f.title.slice(0, 60)), coverage: d.coverage };
    }, back);
    log(` back=${back}:`, JSON.stringify(out));
  }
  await c.close();
}

await browser.close();
log("\ndone");
