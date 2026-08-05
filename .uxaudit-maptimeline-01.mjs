import { launch, page, settle, view, waitForData, snapshot, SHOTS, BASE } from "./.uxaudit-maptimeline-surface.mjs";

const browser = await launch();
const p = await page(browser);

const t0 = Date.now();
await p.goto(`${BASE}/?bird=osprey&region=northeast&days=7`, { waitUntil: "domcontentloaded" });
console.log("== initial load: osprey / northeast / 7 days ==");
// sample the camera early, before data lands, then after
await p.waitForTimeout(1200);
await settle(p, 0);
console.log("t=1.2s view:", JSON.stringify(await view(p)));
await waitForData(p);
await settle(p, 800);
const v = await view(p);
console.log("after data view:", JSON.stringify(v));
const snap = await snapshot(p);
console.log("snapshot:", JSON.stringify(snap, null, 1));
console.log("elapsed ms", Date.now() - t0);
await p.screenshot({ path: `${SHOTS}/01-osprey-ne-7d.png` });

// pull the raw payload so we know the true data bounds
const data = await p.evaluate(async () => {
  const r = await fetch("/api/sightings?species=osprey&back=7&includeProvisional=true&hotspot=false&regions=" +
    encodeURIComponent(new URLSearchParams(location.search).get("states") || ""), {});
  return r.ok ? await r.json() : { error: r.status };
});
console.log("direct payload probe status:", data.error ?? (data.featureCollection?.features?.length + " features"));

await browser.close();
