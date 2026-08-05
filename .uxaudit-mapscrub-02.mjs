import { chromium } from "playwright";
import { newPage, freeze, mapState, readUi, waitLoaded, shot, BASE } from "./.uxaudit-mapscrub.mjs";

const browser = await chromium.launch();
const { ctx, page } = await newPage(browser);

const api = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) {
    try {
      const j = await r.json();
      api.push({ status: r.status(), cov: j.coverage, n: j.featureCollection?.features?.length });
    } catch { api.push({ status: r.status(), err: true }); }
  }
});

console.log("=== T2: slider across every position (osprey, NE, 7d) ===");
await page.goto(`${BASE}/?bird=osprey&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
await waitLoaded(page);
await freeze(page);
console.log("api:", JSON.stringify(api));

const base = await readUi(page);
console.log("mode:", await page.$eval(".scrubber .segmented button.active", (b) => b.textContent.trim()));
console.log("masthead:", base.meta);

// sum of histogram bar counts should equal the window total in the masthead
const barCounts = base.barLabels.map((l) => Number(l.match(/: ([\d,]+) location/)[1].replace(/,/g, "")));
console.log("bar counts:", barCounts, "sum:", barCounts.reduce((a, b) => a + b, 0));

async function setDay(i) {
  await page.$eval(".day-rail", (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, i);
  await page.waitForTimeout(260);
}

for (const mode of ["Trail", "New"]) {
  await page.click(`.scrubber .segmented button:text-is("${mode}")`);
  await page.waitForTimeout(300);
  await freeze(page);
  console.log(`\n--- mode ${mode} ---`);
  for (let i = 0; i <= base.dayMax; i++) {
    await setDay(i);
    const u = await readUi(page);
    const m = await mapState(page);
    const footN = Number((u.scrubFoot.match(/^([\d,]+)/) || [0, "0"])[1].replace(/,/g, ""));
    console.log(
      `  day ${i}: rail=${u.dayIndex} date="${u.scrubDate}" foot=${footN}` +
      ` expect=${mode === "New" ? barCounts[i] : barCounts.slice(0, i + 1).reduce((a, b) => a + b, 0)}` +
      ` masthead="${u.meta.split("·")[0].trim()}" zoom=${m.zoom}` +
      ` current-bar=${u.barClasses.findIndex((c) => c.includes("current"))}`
    );
  }
}

console.log("\napi calls during scrub:", api.length);
await browser.close();
