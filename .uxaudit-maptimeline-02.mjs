import { launch, page, settle, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";
import crypto from "node:crypto";

const browser = await launch();
const p = await page(browser);

const canvasHash = async () => {
  const d = await p.evaluate(() => {
    const c = document.querySelector(".leaflet-pane canvas");
    if (!c) return null;
    try { return c.toDataURL(); } catch { return "tainted"; }
  });
  if (!d) return "no-canvas";
  if (d === "tainted") return "tainted";
  return crypto.createHash("md5").update(d).digest("hex").slice(0, 10);
};

const read = () => p.evaluate(() => {
  const txt = (s) => { const e = document.querySelector(s); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const rail = document.querySelector("input.day-rail");
  return {
    railValue: rail ? +rail.value : null,
    date: txt(".scrubber-date"),
    foot: txt(".scrubber-foot"),
    meta: txt(".masthead-meta"),
    index: txt(".sighting-index p"),
    mode: txt(".scrubber .segmented .active"),
    current: [...document.querySelectorAll(".histogram button")].findIndex(b => b.className.includes("current"))
  };
});

const setRail = async (i) => {
  await p.evaluate((idx) => {
    const rail = document.querySelector("input.day-rail");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(rail, String(idx));
    rail.dispatchEvent(new Event("input", { bubbles: true }));
    rail.dispatchEvent(new Event("change", { bubbles: true }));
  }, i);
  await p.waitForTimeout(220);
  await killMotion(p);
};

for (const mode of ["trail", "new"]) {
  await p.goto(`${BASE}/?bird=osprey&days=7${mode === "new" ? "&mode=new" : ""}`, { waitUntil: "domcontentloaded" });
  await waitForData(p);
  await settle(p, 700);
  console.log(`\n===== MODE ${mode} =====`);
  for (let i = 0; i <= 6; i++) {
    await setRail(i);
    const r = await read();
    const h = await canvasHash();
    console.log(`i=${i} rail=${r.railValue} curBar=${r.current} canvas=${h}`);
    console.log(`   date="${r.date}"`);
    console.log(`   foot="${r.foot}"`);
    console.log(`   index="${r.index}"`);
    console.log(`   meta="${r.meta}"  mode=${r.mode}`);
  }
}

// Real pointer drag on the rail (not synthetic events) at one position, to be sure
await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p);
await settle(p, 700);
const box = await p.locator("input.day-rail").boundingBox();
console.log("\nrail box:", JSON.stringify(box));
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(400);
await killMotion(p);
console.log("after real drag:", JSON.stringify(await read()));
await p.screenshot({ path: `${SHOTS}/02-after-drag.png` });

await browser.close();
