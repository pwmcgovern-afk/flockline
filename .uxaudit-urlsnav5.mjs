import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "https://flockline.app";
const KILL = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
const log = (...a) => console.log(...a);
async function freeze(p) { await p.addStyleTag({ content: KILL }).catch(() => {}); await p.evaluate(() => document.body.offsetHeight); }
async function ctxFor(browser, vp = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport: vp, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
  return ctx;
}
const u = (p) => p.evaluate(() => location.href);
const hl = (p) => p.evaluate(() => history.length);
async function pickBird(page, name) {
  await page.locator(".masthead-title").click();
  await page.waitForTimeout(800);
  await page.keyboard.type(name, { delay: 30 });
  await page.waitForTimeout(1600);
  await page.locator(".picker-results button").first().click();
  await page.waitForTimeout(3500);
}

const browser = await chromium.launch();

// ---- 0. instrument the Enter re-open ----
{
  log("===== 0. WHY DOES ENTER REOPEN THE PICKER =====");
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    window.__ev = [];
    document.addEventListener("click", (e) => window.__ev.push("click:" + (e.target.className || e.target.tagName)), true);
    document.addEventListener("keydown", (e) => window.__ev.push("keydown:" + e.key + "@" + (e.target.className || e.target.tagName)), true);
    document.addEventListener("keyup", (e) => window.__ev.push("keyup:" + e.key + "@" + (e.target.className || e.target.tagName)), true);
  });
  await page.locator(".masthead-title").click();
  await page.waitForTimeout(800);
  await page.evaluate(() => (window.__ev = []));
  await page.keyboard.type("Osprey", { delay: 30 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window.__ev = []));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  log("events:", JSON.stringify(await page.evaluate(() => window.__ev)));
  log("state:", JSON.stringify(await page.evaluate(() => ({ backdrop: !!document.querySelector(".picker-backdrop"), q: document.querySelector(".picker input")?.value, url: location.href }))));
  await freeze(page);
  await page.screenshot({ path: `${OUT}/picker-enter-reopened.png` });
  // is Escape the only way out?
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  log("after Escape:", JSON.stringify(await page.evaluate(() => ({ backdrop: !!document.querySelector(".picker-backdrop"), url: location.href, bird: document.querySelector(".masthead-title")?.textContent?.trim() }))));
  await ctx.close();
}

// ---- A. history with mouse-driven selection ----
{
  log("\n===== A. HISTORY =====");
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  log("0 start:", await u(page), "hist:", await hl(page));
  await pickBird(page, "Osprey");
  log("1 bird:", await u(page), "hist:", await hl(page));
  await page.locator("button").filter({ hasText: /^14D$/ }).first().click();
  await page.waitForTimeout(4000);
  log("2 days:", await u(page), "hist:", await hl(page));
  await page.locator("button").filter({ hasText: /^Insights$/ }).first().click();
  await page.waitForTimeout(5000);
  log("3 insights:", await u(page), "hist:", await hl(page));
  const west = page.locator(".drawer button").filter({ hasText: /^West$/ }).first();
  log("   west chip in drawer:", await page.locator(".drawer button").filter({ hasText: /^West$/ }).count());
  if (await west.count()) { await west.click(); await page.waitForTimeout(6000); }
  log("4 pinned west:", await u(page), "hist:", await hl(page));
  await freeze(page);
  await page.screenshot({ path: `${OUT}/hist-state4.png` });
  // click a finding inside insights (may change the map species)
  const finding = page.locator(".drawer .finding button, .drawer article button").first();
  log("   finding buttons:", await page.locator(".drawer .finding button, .drawer article button").count());
  if (await finding.count()) { await finding.click(); await page.waitForTimeout(6000); log("5 after finding click:", await u(page), "hist:", await hl(page)); }
  for (let i = 1; i <= 2; i++) {
    await page.goBack().catch((e) => log("goBack err"));
    await page.waitForTimeout(2500);
    log(`BACK ${i} ->`, await u(page));
  }
  await ctx.close();
}

// ---- B. drawer <-> URL sync ----
{
  log("\n===== B. DRAWER <-> URL =====");
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?bird=osprey&view=insights`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  log("loaded:", await u(page));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  log("after Escape:", await u(page), "drawer:", await page.locator(".drawer").count());
  await page.locator("button").filter({ hasText: /^Ask$/ }).first().click();
  await page.waitForTimeout(2500);
  log("after Ask:", await u(page));
  await page.locator("button").filter({ hasText: /^My birds$/ }).first().click();
  await page.waitForTimeout(2500);
  log("after My birds:", await u(page));
  await page.locator(".menu-pill").click();
  await page.waitForTimeout(2000);
  log("after Menu:", await u(page), "(menu is a drawer but should not appear in the URL)");
  const menuShare = page.locator(".drawer button").filter({ hasText: /Copy link/i }).first();
  if (await menuShare.count()) {
    await menuShare.click(); await page.waitForTimeout(600);
    log("menu Copy link ->", await page.evaluate(() => navigator.clipboard.readText()));
    await freeze(page);
    await page.screenshot({ path: `${OUT}/menu-copy-link.png` });
  }
  await page.locator(".masthead-eyebrow").click();
  await page.waitForTimeout(3000);
  log("after wordmark reset:", await u(page), "hist:", await hl(page));
  await ctx.close();
}

// ---- C. insights link round-trip ----
{
  log("\n===== C. INSIGHTS LINK =====");
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?bird=osprey&view=insights`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const west = page.locator(".drawer button").filter({ hasText: /^West$/ }).first();
  if (await west.count()) { await west.click(); await page.waitForTimeout(7000); }
  const d3 = page.locator(".drawer button").filter({ hasText: /^3D$/ }).first();
  log("3D in drawer:", await page.locator(".drawer button").filter({ hasText: /^3D$/ }).count());
  if (await d3.count()) { await d3.click(); await page.waitForTimeout(7000); }
  log("url after pin:", await u(page));
  const btns = await page.locator(".drawer button").evaluateAll((ns) => ns.map((n) => `${n.className}|${(n.getAttribute("aria-label") || n.textContent).trim().slice(0, 30)}`));
  log("drawer buttons:", JSON.stringify(btns.slice(0, 24)));
  const linkBtn = page.locator(".drawer button").filter({ hasText: /link/i }).first();
  if (await linkBtn.count()) {
    await linkBtn.click(); await page.waitForTimeout(700);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    log("copied:", copied);
    const ctx2 = await ctxFor(browser); const p2 = await ctx2.newPage();
    await p2.goto(copied, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(9000); await freeze(p2);
    log("reopened url:", await u(p2));
    log("reopened body:", (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 380));
    await p2.screenshot({ path: `${OUT}/insights-shared-reopen.png` });
    await ctx2.close();
  } else log("NO LINK BUTTON FOUND");
  await ctx.close();
}

// ---- D. states param forms ----
{
  log("\n===== D. STATES PARAM =====");
  const ctx = await ctxFor(browser);
  const page = await ctx.newPage();
  for (const q of ["states=US-CT,US-MA", "states=CT,MA", "states=us-ct", "states=US-CT,ZZ", "region=WEST", "region=Nationwide"]) {
    await page.goto(`${BASE}/?bird=osprey&${q}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => ({ url: location.href, meta: document.querySelector(".masthead-meta")?.textContent?.trim() }));
    log(q.padEnd(22), "->", s.url, "|", s.meta);
  }
  await page.goto(`${BASE}/?bird=osprey&states=CT,MA`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000); await freeze(page);
  await page.screenshot({ path: `${OUT}/states-two-letter.png` });
  await ctx.close();
}

// ---- E. mobile back ----
{
  log("\n===== E. MOBILE =====");
  const ctx = await ctxFor(browser, { width: 390, height: 844 });
  const page = await ctx.newPage();
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/?bird=osprey`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await page.locator("button").filter({ hasText: /^Insights$/ }).first().click();
  await page.waitForTimeout(5000); await freeze(page);
  log("mobile insights:", await u(page), "hist:", await hl(page));
  await page.screenshot({ path: `${OUT}/mobile-insights-open.png` });
  await page.goBack();
  await page.waitForTimeout(2500);
  log("mobile BACK ->", await u(page));
  await page.screenshot({ path: `${OUT}/mobile-after-back.png` });
  await ctx.close();
}

await browser.close();
log("\nDONE");
