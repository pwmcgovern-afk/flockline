/**
 * Renders scripts/og-card.html to public/og.png at the Open Graph standard
 * 1200x630. Run with `node scripts/render-og.mjs` after editing the card.
 *
 * Rendered at 2x and downscaled by the consumer, which keeps the large serif
 * wordmark crisp on retina timelines without shipping a second asset.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cardPath = path.join(here, "og-card.html");
const outPath = path.join(here, "..", "public", "og.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

await page.goto(`file://${cardPath}`);
// Google Fonts arrive over the network, and screenshotting before they land
// silently ships the Georgia fallback.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

await page.screenshot({ path: outPath });
await browser.close();

console.log(`wrote ${outPath}`);
