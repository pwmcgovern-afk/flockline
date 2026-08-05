import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/askshots";
const BASE = "https://flockline.app";
const KILL = `*,*::before,*::after{transition:none !important;animation:none !important}`;
const log = (...a) => console.log(...a);
const freeze = async (p) => { await p.addStyleTag({ content: KILL }).catch(()=>{}); await p.evaluate(() => void document.body.offsetHeight).catch(()=>{}); };
const snap = async (p, tag) => {
  const s = await p.evaluate(() => ({
    url: location.href,
    masthead: (document.querySelector(".masthead")?.innerText || "").replace(/\n/g, " | ").slice(0, 180),
    markers: document.querySelectorAll(".leaflet-marker-icon").length,
    circles: document.querySelectorAll(".leaflet-interactive").length,
    notes: [...document.querySelectorAll(".map-note, .map-empty")].map(n => n.textContent.trim().replace(/\s+/g," ").slice(0, 150)),
    drawerOpen: !!document.querySelector("aside.drawer"),
  }));
  log(`  [${tag}]`, JSON.stringify(s));
  return s;
};

const browser = await chromium.launch();

// ---------- 0. attribution overlap probe (no API) ----------
{
  for (const [w, h] of [[375, 667], [844, 390], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?view=ask`, { waitUntil: "networkidle" });
    await freeze(page);
    await page.waitForTimeout(500);
    const o = await page.evaluate(() => {
      const attr = document.querySelector(".leaflet-control-attribution");
      const comp = document.querySelector(".chat-composer");
      const send = document.querySelector(".chat-send");
      const drawer = document.querySelector("aside.drawer");
      if (!attr || !comp) return null;
      const a = attr.getBoundingClientRect(), c = comp.getBoundingClientRect(), s = send.getBoundingClientRect(), d = drawer.getBoundingClientRect();
      const overlaps = (r1, r2) => !(r1.right <= r2.left || r1.left >= r2.right || r1.bottom <= r2.top || r1.top >= r2.bottom);
      const hitAtSend = document.elementFromPoint(s.left + s.width/2, s.top + s.height/2);
      const hitAtAttrCenter = document.elementFromPoint(a.left + a.width/2, a.top + a.height/2);
      return {
        attr: { l: Math.round(a.left), t: Math.round(a.top), r: Math.round(a.right), b: Math.round(a.bottom), z: getComputedStyle(attr).zIndex, text: attr.textContent.trim() },
        drawerLeft: Math.round(d.left), drawerZ: getComputedStyle(drawer).zIndex,
        composer: { l: Math.round(c.left), t: Math.round(c.top), r: Math.round(c.right), b: Math.round(c.bottom) },
        attrOverlapsComposer: overlaps(a, c),
        attrOverlapsDrawer: overlaps(a, d),
        attrOverlapsSendButton: overlaps(a, s),
        hitAtSendCenter: hitAtSend ? `${hitAtSend.tagName}.${hitAtSend.className}` : "none",
        hitAtAttrCenter: hitAtAttrCenter ? `${hitAtAttrCenter.tagName}.${hitAtAttrCenter.className}` : "none",
        leafletPaneZ: getComputedStyle(document.querySelector(".leaflet-control-container") || document.body).zIndex
      };
    });
    log(`\n@@ attribution overlap ${w}x${h}:`, JSON.stringify(o, null, 1));
    await page.screenshot({ path: `${OUT}/attr-${w}x${h}.png`, clip: { x: Math.max(0, w - 420), y: Math.max(0, h - 120), width: Math.min(420, w), height: Math.min(120, h) } });
    await ctx.close();
  }
}

// ---------- 1..3 live chat ----------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
const page = await ctx.newPage();
const net = [];
page.on("response", async (r) => {
  if (!r.url().includes("/api/chat")) return;
  let b = null; try { b = await r.json(); } catch {}
  net.push({ status: r.status(), mapAction: b?.mapAction ?? null, refs: b?.speciesRefs ?? null, error: b?.error ?? null, head: (b?.reply || "").slice(0, 120) });
});
page.on("requestfailed", (r) => { if (r.url().includes("/api/")) log("  [requestfailed]", r.url().replace(BASE, ""), r.failure()?.errorText); });
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") log("  [console error]", m.text().slice(0, 180)); });

await page.goto(`${BASE}/?view=ask`, { waitUntil: "networkidle" });
await freeze(page);
await page.waitForTimeout(400);

async function ask(page, q, wait = 200000) {
  log(`\n--- ASK (${q.length} chars): ${JSON.stringify(q.slice(0, 80))}`);
  await page.locator(".chat-composer input").fill(q);
  await freeze(page);
  const t0 = Date.now();
  await page.locator(".chat-send").click();
  await page.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: wait }).catch(() => log("  ** TIMEOUT **"));
  await freeze(page);
  await page.waitForTimeout(1000);
  const msgs = await page.locator(".chat-msg").allInnerTexts();
  log(`  ${Math.round((Date.now()-t0)/1000)}s | last:`, JSON.stringify((msgs[msgs.length-1]||"").replace(/\n+/g," / ").slice(0, 500)));
  log("  error:", JSON.stringify(await page.locator(".chat-error").innerText().catch(() => "(none)")), "| input kept:", JSON.stringify(await page.locator(".chat-composer input").inputValue()));
}

// 1. Sanibel then click a Florida chip
await ask(page, "what is around Sanibel Island?");
const chips = page.locator(".chat-msg.assistant .chat-refs button");
log("  chips:", await chips.allInnerTexts());
await snap(page, "before chip click");
if (await chips.count()) {
  await chips.first().click();
  await freeze(page);
  await page.waitForTimeout(9000);
  await freeze(page);
  await snap(page, "after FL chip click");
  await page.screenshot({ path: `${OUT}/r3-01-fl-chip.png` });
}

// 2. explicit "show me" -> mapAction, and abort mid-flight
log("\n--- MID-FLIGHT ABORT: send then close the drawer immediately ---");
await page.locator(".chat-composer input").fill("show me ospreys in Maine");
await freeze(page);
await page.locator(".chat-send").click();
await page.waitForTimeout(800);
log("  typing dots present:", await page.locator(".chat-typing").count());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
log("  drawer after Escape mid-flight:", await page.locator("aside.drawer").count());
await page.waitForTimeout(25000);
await freeze(page);
await snap(page, "25s after aborting mid-flight");
await page.screenshot({ path: `${OUT}/r3-02-midflight-closed.png` });
await page.locator("button.tab-ask").click();
await freeze(page);
await page.waitForTimeout(1500);
const msgs2 = await page.locator(".chat-msg").allInnerTexts();
log("  transcript after reopening:", msgs2.length, "msgs | last:", JSON.stringify((msgs2[msgs2.length-1]||"").replace(/\n+/g," / ").slice(0, 400)));
log("  typing dots still spinning?", await page.locator(".chat-typing").count());
log("  error:", JSON.stringify(await page.locator(".chat-error").innerText().catch(() => "(none)")));
await snap(page, "after reopening");
await page.screenshot({ path: `${OUT}/r3-03-reopened-after-abort.png` });

log("\nNET:", JSON.stringify(net, null, 1));
fs.writeFileSync(`${OUT}/net-run3.json`, JSON.stringify(net, null, 2));
await ctx.close();
await browser.close();
log("DONE");
