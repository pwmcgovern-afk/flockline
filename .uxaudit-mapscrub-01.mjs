import { chromium } from "playwright";
import { newPage, freeze, mapState, readUi, waitLoaded, shot, BASE } from "./.uxaudit-mapscrub.mjs";

const browser = await chromium.launch();
const { ctx, page } = await newPage(browser);

console.log("=== TEST 1: initial fit at ?bird=osprey&region=northeast&days=7 ===");
await page.goto(`${BASE}/?bird=osprey&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
await waitLoaded(page);
await freeze(page);

const ms = await mapState(page);
const ui = await readUi(page);
console.log("map:", JSON.stringify(ms, null, 1));
console.log("ui:", JSON.stringify(ui, null, 1));
console.log("shot:", await shot(page, "01-initial-osprey-ne"));

// Northeast preset states — what is the expected bbox?
console.log("\n=== bounds sanity ===");
if (ms.bounds) {
  const b = ms.bounds;
  console.log(`lat ${b.south.toFixed(2)}..${b.north.toFixed(2)}  lng ${b.west.toFixed(2)}..${b.east.toFixed(2)}`);
  console.log(`span: ${(b.north - b.south).toFixed(1)} deg lat, ${(b.east - b.west).toFixed(1)} deg lng`);
}

await browser.close();
