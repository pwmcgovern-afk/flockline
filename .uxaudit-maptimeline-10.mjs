import { launch, page, settle, view, project, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);
let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) { try { payload = await r.json(); } catch {} }
});

const st = () => p.evaluate(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  return {
    title: t(".masthead-title"), meta: t(".masthead-meta"),
    date: t(".scrubber-date"), foot: t(".scrubber-foot"),
    play: (document.querySelector(".play-button") || {}).getAttribute?.("aria-label"),
    rail: +(document.querySelector("input.day-rail") || { value: -1 }).value,
    sheet: (document.querySelector("aside.sighting-sheet") || {}).textContent?.replace(/\s+/g, " ").trim().slice(0, 130) || null,
    url: location.href
  };
});

console.log("===== A. switch species mid-playback =====");
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1000);
await p.locator(".histogram button").first().click();
await p.waitForTimeout(200);
await p.locator(".play-button").click();
await p.waitForTimeout(1000);
console.log("playing:", JSON.stringify(await st()));
await p.locator(".masthead-title").click();
await p.waitForTimeout(600);
await p.locator(".picker input[type='search'], .picker input").first().fill("Bald Eagle");
await p.waitForTimeout(1200);
const results = await p.locator(".picker-results button").allTextContents();
console.log("picker results:", results.slice(0, 3));
await p.locator(".picker-results button").first().click();
await p.waitForTimeout(700);
console.log("right after species switch:", JSON.stringify(await st()));
await waitForData(p, 40000);
await settle(p, 1500);
console.log("settled:", JSON.stringify(await st()));
await p.waitForTimeout(2000);
console.log("+2s (did playback resume?):", JSON.stringify(await st()));
await p.screenshot({ path: `${SHOTS}/10-species-switch.png` });

console.log("\n===== B. switch region while a record is open =====");
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(`${BASE}/?bird=osprey&days=7&states=US-ME`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1500);
const v = await view(p);
let opened = null;
for (const f of payload.featureCollection.features) {
  const [lng, lat] = f.geometry.coordinates;
  const s = await project(p, lat, lng);
  if (s && s.x > 40 && s.x < v.container.w - 380 && s.y > v.container.y + 40 && s.y < v.container.y + 300) {
    await p.mouse.click(s.x, s.y);
    await p.waitForTimeout(700);
    if (await p.locator("aside.sighting-sheet").count()) { opened = f.properties.locName; break; }
  }
}
console.log("record open:", opened);
await p.locator(".menu-pill").click();
await p.waitForTimeout(700);
const presets = await p.locator(".drawer button").allTextContents();
console.log("drawer buttons:", presets.slice(0, 18));
// pick the "Southeast" or another region preset
const target = p.locator(".drawer button", { hasText: /^Southeast$/ }).first();
if (await target.count()) {
  await target.click();
} else {
  await p.locator(".drawer button", { hasText: /^Pacific|^West|^Midwest/ }).first().click();
}
await p.waitForTimeout(900);
console.log("right after region switch:", JSON.stringify(await st()));
await waitForData(p, 40000);
await settle(p, 2000);
const afterRegion = await st();
console.log("settled:", JSON.stringify(afterRegion));
console.log("record still open with an out-of-region sighting?", afterRegion.sheet ? "YES -> " + afterRegion.sheet.slice(0, 90) : "no");
await p.keyboard.press("Escape");
await p.waitForTimeout(500);
await killMotion(p);
await p.screenshot({ path: `${SHOTS}/10-region-switch-record.png` });
console.log("view after region switch:", JSON.stringify((await view(p)).bounds));

console.log("\n===== C. back button =====");
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p, 40000);
await settle(p, 1200);
const hist0 = await p.evaluate(() => history.length);
await p.locator(".window-pills button", { hasText: "30D" }).click().catch(() => {});
await p.waitForTimeout(1200);
await p.locator(".scrubber .segmented button", { hasText: "New" }).click();
await p.waitForTimeout(800);
const hist1 = await p.evaluate(() => history.length);
console.log("history length before/after two state changes:", hist0, hist1, "url:", await p.evaluate(() => location.href));
await p.goBack().catch((e) => console.log("goBack err", String(e).slice(0, 80)));
await p.waitForTimeout(1500);
await killMotion(p);
console.log("after Back:", JSON.stringify(await st()));

await browser.close();
