import { launch, page, settle, view, project, waitForData, SHOTS, BASE, killMotion } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);

let payload = null;
p.on("response", async (r) => {
  if (r.url().includes("/api/sightings")) {
    try { payload = await r.json(); } catch {}
  }
});

const sheet = () => p.evaluate(() => {
  const a = document.querySelector("aside.sighting-sheet") || document.querySelector(".stage aside");
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return {
    text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 320),
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    cls: a.className,
    checklistHref: (a.querySelector('a[href*="ebird.org/checklist"]') || {}).href || null
  };
});

await p.goto(`${BASE}/?bird=osprey&days=7`, { waitUntil: "domcontentloaded" });
await waitForData(p);
await settle(p, 1200);
console.log("features:", payload?.featureCollection?.features?.length);
const v = await view(p);
console.log("view:", JSON.stringify({ zoom: v.zoom, bounds: v.bounds }));

// Project every feature to screen, find isolated ones and the densest cluster.
const feats = payload.featureCollection.features;
const pts = [];
for (const f of feats) {
  const [lng, lat] = f.geometry.coordinates;
  const s = await project(p, lat, lng);
  pts.push({ f, s });
}
const inView = pts.filter(q => q.s && q.s.x > 20 && q.s.x < v.container.w - 20 && q.s.y > v.container.y + 20 && q.s.y < v.container.y + v.container.h - 140);
console.log("in-view projected:", inView.length);

// density: count neighbours within 6px
for (const q of inView) {
  q.n = inView.filter(o => Math.hypot(o.s.x - q.s.x, o.s.y - q.s.y) < 6).length;
}
inView.sort((a, b) => b.n - a.n);
const dense = inView[0];
const isolated = inView.filter(q => q.n === 1)[0];
console.log("densest point neighbours:", dense.n, "at", dense.s, dense.f.properties.locName);
console.log("isolated point:", isolated?.f.properties.locName, isolated?.s);

async function clickAt(x, y, label) {
  await p.mouse.click(x, y);
  await p.waitForTimeout(700);
  await killMotion(p);
  const s = await sheet();
  console.log(`  click ${label} @(${Math.round(x)},${Math.round(y)}):`, s ? s.text.slice(0, 150) : "NO SHEET");
  return s;
}

console.log("\n=== A. click an isolated dot ===");
const s1 = await clickAt(isolated.s.x, isolated.s.y, "isolated");
console.log("  expected locName:", isolated.f.properties.locName, "| match:", s1 && s1.text.includes(isolated.f.properties.locName));
await p.screenshot({ path: `${SHOTS}/05-record-isolated.png` });
console.log("  sheet box:", JSON.stringify(s1?.box), "cls:", s1?.cls);

console.log("\n=== B. close it ===");
await p.keyboard.press("Escape");
await p.waitForTimeout(400);
console.log("  after Escape:", JSON.stringify(await sheet()));
const closeBtn = await p.locator("aside button[aria-label*='lose'], aside .close").count();
console.log("  explicit close buttons in aside:", closeBtn);

console.log("\n=== C. click a dot in the densest cluster, then another ===");
const s2 = await clickAt(dense.s.x, dense.s.y, "dense");
const cluster = inView.filter(q => Math.hypot(q.s.x - dense.s.x, q.s.y - dense.s.y) < 6);
console.log("  cluster members:", cluster.map(q => q.f.properties.locName));
console.log("  sheet shows one of them:", cluster.some(q => s2 && s2.text.includes(q.f.properties.locName)));
await p.screenshot({ path: `${SHOTS}/05-record-dense.png` });

// open another, check for stale content
const other = inView.filter(q => q.n === 1)[3] || inView[10];
const s3 = await clickAt(other.s.x, other.s.y, "another");
console.log("  expected:", other.f.properties.locName, "| match:", s3 && s3.text.includes(other.f.properties.locName));
console.log("  still contains previous locName?", s2 && s3 && cluster.some(q => s3.text.includes(q.f.properties.locName)));

console.log("\n=== D. click empty map (no dot) ===");
const s4 = await clickAt(60, v.container.y + 60, "empty area");
console.log("  sheet after empty click:", s4 ? "STILL OPEN" : "closed/none");

await browser.close();
