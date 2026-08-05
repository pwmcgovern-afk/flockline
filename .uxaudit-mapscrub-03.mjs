import { chromium } from "playwright";
import { newPage, freeze, mapState, readUi, waitLoaded, shot, BASE } from "./.uxaudit-mapscrub.mjs";

const browser = await chromium.launch();
const { ctx, page } = await newPage(browser);
const cov = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) {
    try { const j = await r.json(); cov.push(`${j.coverage?.successfulRegions?.length}/${j.coverage?.requestedRegions?.length}`); } catch {}
  }
});

console.log("=== T3: playback ===");
await page.goto(`${BASE}/?bird=osprey&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
await waitLoaded(page);
await freeze(page);
console.log("coverage:", cov.join(","));

const rail = () => page.$eval(".day-rail", (e) => Number(e.value));
const label = () => page.$eval(".play-button", (e) => e.getAttribute("aria-label"));

console.log("start rail:", await rail(), "label:", await label());
await page.click(".play-button");
await page.waitForTimeout(120);
console.log("after click label:", await label(), "rail:", await rail());

// sample the rail every 300ms for 8s
const samples = [];
for (let i = 0; i < 28; i++) {
  await page.waitForTimeout(300);
  samples.push(`${await rail()}${(await label()).startsWith("Pause") ? "P" : "."}`);
}
console.log("rail samples (P=playing):", samples.join(" "));
console.log("end rail:", await rail(), "label:", await label());
console.log("scrubDate at end:", await page.$eval(".scrubber-date", (e) => e.textContent.trim()));

// press play again at the end -- does it restart?
console.log("\n--- press play again while parked at the end ---");
await page.click(".play-button");
await page.waitForTimeout(400);
console.log("rail:", await rail(), "label:", await label());
await page.waitForTimeout(1500);
console.log("after 1.5s rail:", await rail(), "label:", await label());
console.log("shot:", await shot(page, "03-replay-at-end"));

// stop mid playback
console.log("\n--- can we stop it? ---");
await page.$eval(".day-rail", (el) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  s.call(el, "0"); el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(200);
await page.click(".play-button");
await page.waitForTimeout(1900);
const midRail = await rail();
await page.click(".play-button");
await page.waitForTimeout(1400);
console.log(`paused at ${midRail}, 1.4s later rail=${await rail()} label=${await label()}`);

// drag while playing
console.log("\n--- drag while playing ---");
await page.click(".play-button");
await page.waitForTimeout(700);
console.log("playing, label:", await label());
await page.$eval(".day-rail", (el) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  s.call(el, "3"); el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(150);
console.log("right after drag: rail:", await rail(), "label:", await label());
await page.waitForTimeout(1800);
console.log("1.8s later: rail:", await rail(), "label:", await label());

// click a histogram bar while playing
console.log("\n--- histogram bar click while playing ---");
await page.click(".play-button");
await page.waitForTimeout(600);
await page.click(".histogram button:nth-child(2)");
await page.waitForTimeout(1600);
console.log("rail:", await rail(), "label:", await label());

console.log("\ncoverage all:", cov.join(","));
await browser.close();
