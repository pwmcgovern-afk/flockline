/**
 * Renders scripts/og-card.html to a versioned 1200x630 social image. The
 * filename changes when a crawler cache must be invalidated, while the old
 * asset remains available for previously shared links.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cardPath = path.join(here, "og-card.html");
const outPath = path.join(here, "..", "public", "flockline-social-v2.jpg");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.goto(`file://${cardPath}`);
// Google Fonts arrive over the network, and screenshotting before they land
// silently ships the Georgia fallback.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

await page.screenshot({ path: outPath, type: "jpeg", quality: 90 });
await browser.close();

console.log(`wrote ${outPath}`);
