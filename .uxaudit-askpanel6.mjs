import { chromium } from "playwright";
const OUT = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/askshots";
const BASE = "https://flockline.app";
const KILL = `*,*::before,*::after{transition:none !important;animation:none !important}`;
const log = (...a) => console.log(...a);
const freeze = async (p) => { await p.addStyleTag({ content: KILL }).catch(()=>{}); await p.evaluate(() => void document.body.offsetHeight).catch(()=>{}); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 200)));
await page.goto(`${BASE}/?view=ask`, { waitUntil: "networkidle" });
await freeze(page);
await page.waitForTimeout(400);

// Burn the rate-limit bucket with requests that fail validation BEFORE the LLM
// call (empty messages -> 400), so we exercise the 429 path without tokens.
const burn = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 11; i += 1) {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }) });
    let j = null; try { j = await r.json(); } catch {}
    out.push({ i, status: r.status, remaining: r.headers.get("RateLimit-Remaining"), error: j?.error });
  }
  return out;
});
log("burn results:", JSON.stringify(burn));

// Now send a very long message from the UI and see how the error is presented.
const LONG = ("I am planning a two week birding trip along the Atlantic flyway starting in late August and I would like a detailed plan. " +
  "Please tell me which coastal hotspots peak first, which shorebirds are already moving, where the best chances are for rarities, ").repeat(6) +
  "and what I should pack. END OF QUESTION.";
log("long message length:", LONG.length);
await page.locator(".chat-composer input").fill(LONG);
await freeze(page);
await page.locator(".chat-send").click();
await page.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 200000 }).catch(() => log("** timeout **"));
await freeze(page);
await page.waitForTimeout(1500);

const msgs = await page.locator(".chat-msg").allInnerTexts();
log("transcript now:", msgs.length, "messages");
log("last bubble (first 400):", JSON.stringify((msgs[msgs.length-1]||"").replace(/\n+/g," / ").slice(0, 400)));
log(".chat-error:", JSON.stringify(await page.locator(".chat-error").innerText().catch(() => "(none)")));
const kept = await page.locator(".chat-composer input").inputValue();
log("input preserved after failure? length =", kept.length, "| matches original:", kept === LONG);
log("send button enabled for retry:", !(await page.locator(".chat-send").isDisabled()));
const bubble = await page.evaluate(() => {
  const b = document.querySelector(".chat-msg.user .chat-bubble");
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const drawer = document.querySelector("aside.drawer").getBoundingClientRect();
  return { bubbleW: Math.round(r.width), bubbleH: Math.round(r.height), drawerW: Math.round(drawer.width), overflowsDrawer: r.right > drawer.right + 1 || r.left < drawer.left - 1, textLen: b.textContent.length };
});
log("user bubble metrics:", JSON.stringify(bubble));
await page.screenshot({ path: `${OUT}/r4-01-ratelimit-and-long.png` });

// error region: is it visible without scrolling, and is it announced?
const errInfo = await page.evaluate(() => {
  const e = document.querySelector(".chat-error");
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const s = document.querySelector(".chat-scroll");
  return { text: e.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= innerHeight,
    scrollTop: s.scrollTop, scrollH: s.scrollHeight, clientH: s.clientHeight,
    ariaRole: e.getAttribute("role"), ariaLive: e.getAttribute("aria-live"),
    srStatus: document.querySelector('span.sr-only[role="status"]')?.textContent?.slice(0,150) };
});
log("error region:", JSON.stringify(errInfo));

// retry: does resending clear the error and duplicate the user message?
log("\n-- retry with the same preserved text --");
await page.locator(".chat-send").click();
await page.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 200000 }).catch(() => log("** timeout **"));
await freeze(page);
await page.waitForTimeout(1200);
const msgs2 = await page.locator(".chat-msg").allInnerTexts();
log("transcript after retry:", msgs2.length, "messages");
log("roles:", await page.locator(".chat-msg").evaluateAll((els) => els.map((e) => e.className)));
log(".chat-error after retry:", JSON.stringify(await page.locator(".chat-error").innerText().catch(() => "(none)")));
await page.screenshot({ path: `${OUT}/r4-02-after-retry.png` });

// reload: is the conversation gone?
await page.reload({ waitUntil: "networkidle" });
await freeze(page);
await page.waitForTimeout(600);
log("after reload -> url:", page.url(), "| messages:", await page.locator(".chat-msg").count(), "| drawer:", await page.locator("aside.drawer").count());

await ctx.close();
await browser.close();
log("DONE");
