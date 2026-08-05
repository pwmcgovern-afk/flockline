import { launch, page, settle, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);

const read = () => p.evaluate(() => {
  const txt = (s) => { const e = document.querySelector(s); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const rail = document.querySelector("input.day-rail");
  const play = document.querySelector(".play-button");
  return {
    rail: rail ? +rail.value : null,
    date: txt(".scrubber-date"),
    foot: txt(".scrubber-foot"),
    mode: txt(".scrubber .segmented .active"),
    play: play ? play.getAttribute("aria-label") : null,
    pulses: document.querySelectorAll(".flock-pulse-icon").length,
    playingPulses: document.querySelectorAll(".flock-pulse-icon.playing").length,
    url: location.href
  };
});

console.log("===== A. 'see all N' link claim =====");
await p.goto(`${BASE}/?bird=osprey&days=7&mode=new`, { waitUntil: "domcontentloaded" });
await waitForData(p);
await settle(p, 700);
console.log("before:", JSON.stringify(await read()));
const linkText = await p.locator(".scrubber-foot .link").textContent();
await p.locator(".scrubber-foot .link").click();
await p.waitForTimeout(400); await killMotion(p);
const after = await read();
console.log(`clicked "${linkText.trim()}" ->`, JSON.stringify(after));
await p.screenshot({ path: `${SHOTS}/03-see-all.png`, clip: { x: 260, y: 600, width: 760, height: 200 } });

console.log("\n===== B. playback =====");
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p);
await settle(p, 700);
// start from day 0
await p.locator(".histogram button").first().click();
await p.waitForTimeout(200);
console.log("start:", JSON.stringify(await read()));
await p.locator(".play-button").click();
for (let i = 0; i < 9; i++) {
  await p.waitForTimeout(850);
  const r = await read();
  console.log(`  t+${((i + 1) * 0.85).toFixed(2)}s rail=${r.rail} date="${r.date}" play=${r.play} pulses=${r.pulses}/${r.playingPulses}`);
}
console.log("post-run:", JSON.stringify(await read()));

console.log("\n-- press play again at end (does it restart?) --");
await p.locator(".play-button").click();
await p.waitForTimeout(300);
console.log("  immediately:", JSON.stringify(await read()));
await p.waitForTimeout(1800);
console.log("  +1.8s:", JSON.stringify(await read()));

console.log("\n-- pause mid-playback --");
await p.locator(".histogram button").first().click();
await p.waitForTimeout(150);
await p.locator(".play-button").click();
await p.waitForTimeout(1900);
const midR = await read();
await p.locator(".play-button").click();
await p.waitForTimeout(1500);
const stoppedR = await read();
console.log("  mid:", midR.rail, midR.play, " after pause+1.5s:", stoppedR.rail, stoppedR.play);

console.log("\n-- drag while playing --");
await p.locator(".histogram button").first().click();
await p.waitForTimeout(150);
await p.locator(".play-button").click();
await p.waitForTimeout(900);
await p.evaluate(() => {
  const rail = document.querySelector("input.day-rail");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(rail, "4");
  rail.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.waitForTimeout(1200);
console.log("  after drag while playing (+1.2s):", JSON.stringify(await read()));
await p.waitForTimeout(1500);
console.log("  +1.5s more:", JSON.stringify(await read()));

console.log("\n===== C. rail hit target =====");
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p);
await settle(p, 700);
const box = await p.locator("input.day-rail").boundingBox();
console.log("desktop rail box:", JSON.stringify(box));
for (const dy of [0, -5, -8, 5, 8]) {
  await p.evaluate(() => {
    const rail = document.querySelector("input.day-rail");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(rail, "6"); rail.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await p.waitForTimeout(200);
  await p.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2 + dy);
  await p.waitForTimeout(250);
  const r = await read();
  console.log(`  click at dy=${dy}: rail=${r.rail} (moved: ${r.rail !== 6})`);
}

await browser.close();
