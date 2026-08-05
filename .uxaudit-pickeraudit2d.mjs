import { chromium } from "playwright";

const BASE = "https://flockline.app";
const SHOT = "/private/tmp/claude-501/-Users-patrickmcgovern/18ddad7e-075c-4ab0-9e95-5e9be20b82de/scratchpad/picker";
const KILL = `*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }`;
const log = (...a) => console.log(...a);

async function freeze(page) {
  await page.addStyleTag({ content: KILL });
  await page.evaluate(() => { void document.body.offsetHeight; });
}
async function openPicker(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.className.includes("masthead-title"));
    b.click();
  });
  await page.waitForSelector(".picker", { timeout: 8000 });
  await freeze(page);
}
async function goto(page, url = BASE) {
  for (let i = 0; i < 4; i++) {
    try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); return; }
    catch (e) { log("  retry goto", i, e.message.slice(0, 50)); await page.waitForTimeout(2500); }
  }
  throw new Error("goto failed");
}
async function ctxPage(browser, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage.setItem("flockline.tourSeen.v2", "1"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => log("  [pageerror]", e.message));
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch();

  /* ---- H: group filter ignored while searching ---- */
  {
    log("\n=== H: group tab vs search ===");
    const { ctx, page } = await ctxPage(browser);
    await goto(page);
    await freeze(page);
    await openPicker(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".picker-tabs button")].find(x => x.textContent.trim() === "Owls");
      b.click();
    });
    await page.waitForTimeout(500);
    await freeze(page);
    const owls = await page.evaluate(() => ({
      active: document.querySelector(".picker-tabs button.active")?.textContent.trim(),
      n: document.querySelectorAll(".picker-results button").length,
      first3: [...document.querySelectorAll(".picker-results button")].slice(0, 3).map(b => b.textContent.trim()),
      foot: document.querySelector(".picker-foot").textContent.trim()
    }));
    log("Owls tab:", JSON.stringify(owls));
    await page.screenshot({ path: `${SHOT}/40-owls-tab.png` });
    await page.fill(".picker .search input", "hawk");
    await page.waitForTimeout(2200);
    await freeze(page);
    const owlsThenHawk = await page.evaluate(() => ({
      tabsVisible: !!document.querySelector(".picker-tabs"),
      n: document.querySelectorAll(".picker-results button").length,
      first3: [...document.querySelectorAll(".picker-results button")].slice(0, 3).map(b => b.textContent.trim()),
      foot: document.querySelector(".picker-foot").textContent.trim()
    }));
    log('Owls tab + search "hawk":', JSON.stringify(owlsThenHawk));
    await page.screenshot({ path: `${SHOT}/41-owls-tab-search-hawk.png` });
    // clear -> back to owls?
    await page.click('.picker .search [aria-label="Clear search"]');
    await page.waitForTimeout(600);
    await freeze(page);
    log("after clearing:", JSON.stringify(await page.evaluate(() => ({
      active: document.querySelector(".picker-tabs button.active")?.textContent.trim(),
      first: document.querySelector(".picker-results button")?.textContent.trim()
    }))));
    await ctx.close();
  }

  /* ---- I: yellow warbler ranking + Enter ---- */
  {
    log("\n=== I: yellow warbler ranking ===");
    const { ctx, page } = await ctxPage(browser);
    await goto(page);
    await freeze(page);
    await openPicker(page);
    await page.fill(".picker .search input", "yellow warbler");
    await page.waitForTimeout(2500);
    await freeze(page);
    const yw = await page.evaluate(() => [...document.querySelectorAll(".picker-results button")].map(b => b.textContent.trim()));
    log("yellow warbler results:", JSON.stringify(yw));
    await page.screenshot({ path: `${SHOT}/42-yellow-warbler.png` });
    await page.click(".picker .search input");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    log("Enter -> url:", await page.evaluate(() => location.search),
        "| title:", await page.evaluate(() => document.querySelector(".masthead-title")?.textContent.trim()),
        "| pickerOpen:", await page.locator(".picker").count());
    // a few more common-name probes
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    for (const q of ["cardinal", "blue jay", "red tailed hawk", "canada goose", "chickadee"]) {
      await openPicker(page);
      await page.fill(".picker .search input", q);
      await page.waitForTimeout(2200);
      const top = await page.evaluate(() => [...document.querySelectorAll(".picker-results button")].slice(0, 3).map(b => b.textContent.trim()));
      log(`q=${JSON.stringify(q)} top3:`, JSON.stringify(top));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
    await ctx.close();
  }

  /* ---- J: pick a species with no US records ---- */
  {
    log("\n=== J: non-US species from search ===");
    const { ctx, page } = await ctxPage(browser);
    await goto(page);
    await freeze(page);
    await openPicker(page);
    await page.fill(".picker .search input", "arfak robin");
    await page.waitForTimeout(2500);
    const res = await page.evaluate(() => [...document.querySelectorAll(".picker-results button")].map(b => b.textContent.trim()));
    log("arfak robin results:", JSON.stringify(res));
    if (res.length) {
      await page.locator(".picker-results button").first().click();
      await page.waitForTimeout(6000);
      await freeze(page);
      await page.screenshot({ path: `${SHOT}/43-non-us-species.png`, fullPage: false });
      const state = await page.evaluate(() => ({
        title: document.querySelector(".masthead-title")?.textContent.trim(),
        url: location.search,
        bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 700)
      }));
      log("after selecting Arfak Robin:", JSON.stringify(state, null, 1));
    }
    await ctx.close();
  }

  /* ---- K: clear selection + close affordances + back button ---- */
  {
    log("\n=== K: clear selection, close affordance, history ===");
    const { ctx, page } = await ctxPage(browser);
    await goto(page, BASE + "/?bird=osprey");
    await page.waitForTimeout(3000);
    await freeze(page);
    await openPicker(page);
    const affordances = await page.evaluate(() => {
      const p = document.querySelector(".picker");
      return {
        closeBtns: [...p.querySelectorAll("button")].filter(b => /close|dismiss|cancel/i.test(b.getAttribute("aria-label") || b.textContent)).map(b => b.textContent.trim() || b.getAttribute("aria-label")),
        footButtons: [...p.querySelectorAll(".picker-foot button")].map(b => b.textContent.trim()),
        drawerHasClose: true
      };
    });
    log("affordances:", JSON.stringify(affordances));
    await page.screenshot({ path: `${SHOT}/44-picker-with-selection.png` });
    await page.click(".picker-foot button");
    await page.waitForTimeout(1500);
    log("after Clear selection:", JSON.stringify(await page.evaluate(() => ({
      open: !!document.querySelector(".picker"), url: location.search,
      title: document.querySelector(".masthead-title")?.textContent.trim(),
      active: document.activeElement?.className
    }))));
    await freeze(page);
    await page.screenshot({ path: `${SHOT}/45-after-clear-selection.png` });

    // history: pick two birds then hit Back
    await openPicker(page);
    await page.fill(".picker .search input", "osprey");
    await page.waitForTimeout(2000);
    await page.locator(".picker-results button").first().click();
    await page.waitForTimeout(3000);
    await openPicker(page);
    await page.fill(".picker .search input", "bald eagle");
    await page.waitForTimeout(2000);
    await page.locator(".picker-results button").first().click();
    await page.waitForTimeout(3000);
    log("url now:", await page.evaluate(() => location.search),
        "| history length:", await page.evaluate(() => history.length));
    await page.goBack();
    await page.waitForTimeout(2500);
    log("after Back:", await page.evaluate(() => location.href),
        "| title:", await page.evaluate(() => document.querySelector(".masthead-title")?.textContent.trim() ?? "(page gone)"));
    await ctx.close();
  }

  /* ---- L: contrast + type inside picker ---- */
  {
    log("\n=== L: type + contrast ===");
    const { ctx, page } = await ctxPage(browser);
    await goto(page);
    await freeze(page);
    await openPicker(page);
    const type = await page.evaluate(() => {
      const grab = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { sel, family: s.fontFamily.split(",")[0].replace(/["']/g, ""), size: s.fontSize, color: s.color, weight: s.fontWeight, transform: s.textTransform };
      };
      return [".picker-head .script", ".picker-head h2", ".picker .search input", ".picker .search input::placeholder",
              ".picker-tabs button", ".picker-results strong", ".picker-results small", ".picker-foot span",
              ".picker-foot button", ".picker-empty"].map(grab);
    });
    log(JSON.stringify(type, null, 1));
    const contrast = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
          v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bg = getComputedStyle(document.querySelector(".picker")).backgroundColor;
      const ratio = (fg) => { const a = lum(fg), b = lum(bg); return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)); };
      const out = {};
      for (const sel of [".picker-head .script", ".picker-tabs button:not(.active)", ".picker-results small", ".picker-foot span", ".picker-empty"]) {
        const el = document.querySelector(sel);
        if (el) out[sel] = { color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize, ratio: ratio(getComputedStyle(el).color) };
      }
      out.__bg = bg;
      // placeholder
      return out;
    });
    log("contrast vs picker bg:", JSON.stringify(contrast, null, 1));
    await ctx.close();
  }

  await browser.close();
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
