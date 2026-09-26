import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { US_STATES, US_REGION_PRESETS } from "../../shared/usGeography.js";

// Run against the local Vite server. All APIs and map tiles are intercepted:
// these regressions cannot send email, consume AI credits, or scan map tiles.
const base = process.env.UI_TEST_BASE_URL || "http://127.0.0.1:5173";
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),
  "UI regression fixtures are local only",
);
let browser;
let server;
let checks = 0;
const osprey = {
  speciesCode: "osprey",
  comName: "Osprey",
  sciName: "Pandion haliaetus",
  group: "Raptors",
};
const eagle = {
  speciesCode: "baleag",
  comName: "Bald Eagle",
  sciName: "Haliaeetus leucocephalus",
  group: "Raptors",
};
const day = new Date().toLocaleDateString("en-CA");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
const transparent = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2Z0AAAAASUVORK5CYII=",
  "base64",
);
function sightings(url) {
  const species = url.searchParams.get("species") === "baleag" ? eagle : osprey;
  const regions = (url.searchParams.get("regions") || "US-CT").split(",");
  return {
    source: "ebird",
    species,
    back: Number(url.searchParams.get("back") || 7),
    regions,
    coverage: {
      requestedRegions: regions,
      successfulRegions: regions,
      failedRegions: [],
    },
    generatedAt: new Date().toISOString(),
    featureCollection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-72.95, 41.3] },
          properties: {
            ...species,
            locName: "Audit observation",
            locId: "L1",
            obsDt: `${day} 08:00`,
            howMany: 2,
            obsReviewed: true,
            obsValid: true,
            locationPrivate: false,
            subId: "S12345",
            regionCode: regions[0],
          },
        },
      ],
    },
    stats: {
      sightings: 1,
      checklists: 1,
      regionCounts: { [regions[0]]: 1 },
      latestObsDt: `${day} 08:00`,
    },
  };
}
function insights(url) {
  const regions = (url.searchParams.get("regions") || "US-CT").split(",");
  return {
    source: "ebird",
    generator: "template",
    generatedAt: new Date().toISOString(),
    back: Number(url.searchParams.get("back") || 7),
    regions,
    scopeLabel: regions[0],
    coverage: {
      requestedRegions: regions,
      successfulRegions: regions,
      failedRegions: [],
    },
    findings: [
      {
        kind: "rarity",
        title: `Finding for ${regions[0]}`,
        subId: "S123456789",
        detail: "27 notable Osprey reports across 2 states, with up to 2 birds in a single report.",
        speciesCode: "osprey",
        comName: "Osprey",
        regionCode: regions[0],
        lat: 41.3,
        lng: -72.95,
      },
    ],
  };
}
function roundup(scope) {
  return {
    ...insights(new URL(`${base}/?regions=US-CT`)),
    scopeId: scope,
    scopeLabel: US_REGION_PRESETS.find((r) => r.id === scope)?.name,
    summary: "Six notable birds from the past week.",
  };
}
async function session({ width = 1280, height = 900, touch = false, handlers = {} } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: touch,
    hasTouch: touch,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    if (window.top === window) localStorage.setItem("flockline.tourSeen.v2", "1");
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      if (route.request().resourceType() === "image")
        return route.fulfill({ contentType: "image/png", body: transparent });
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (handlers[url.pathname]) return handlers[url.pathname](route, url);
    if (url.pathname === "/api/config")
      return json(route, {
        hasApiKey: true,
        states: US_STATES,
        presets: [osprey, eagle],
        maxBackDays: 30,
      });
    if (url.pathname === "/api/species") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      return json(route, {
        items: [osprey, eagle].filter((s) =>
          `${s.comName} ${s.speciesCode}`.toLowerCase().includes(q),
        ),
      });
    }
    if (url.pathname === "/api/sightings") return json(route, sightings(url));
    if (url.pathname === "/api/insights") return json(route, insights(url));
    if (url.pathname === "/api/roundup")
      return json(route, roundup(url.searchParams.get("region")));
    if (url.pathname === "/api/digest-subscription")
      throw new Error("A signup test must define its own mocked response");
    return json(route, { error: "Unavailable in this scenario" }, 503);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}
async function finish(s) {
  assert.deepEqual(s.errors, [], "No uncaught browser errors");
  await s.context.close();
  checks++;
}
async function openMap(page, query = "?bird=osprey&states=US-CT") {
  await page.goto(base + query);
  await page.waitForFunction(() =>
    document
      .querySelector(".masthead-meta")
      ?.textContent?.includes("1 location"),
  );
}

before(async () => {
  if (
    !(await fetch(base)
      .then((r) => r.ok)
      .catch(() => false))
  ) {
    server = await createServer({
      server: {
        host: "127.0.0.1",
        port: Number(new URL(base).port),
        strictPort: true,
      },
    });
    await server.listen();
  }
  const engine = process.env.UI_TEST_ENGINE === "webkit" ? webkit : chromium;
  browser = await engine.launch({
    channel: engine === chromium && !process.env.CI ? "chrome" : undefined,
    headless: true,
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
  console.log(`${checks} browser scenarios verified`);
});

test("signup fits mobile and short landscape screens, traps focus, and closes with Escape", async () => {
  for (const [width, height] of [
    [375, 812],
    [320, 568],
    [812, 375],
  ]) {
    const s = await session({ width, height });
    const { page } = s;
    await openMap(page);
    const launch = page.locator(".digest-header .digest-cta");
    await launch.click();
    const dialog = page.getByRole("dialog", {
      name: "Weekly insights signup",
      exact: true,
    });
    const box = await dialog.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width &&
        box.y + box.height <= height,
      "Dialog stays inside viewport",
    );
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill("audit@example.com");
    await page.getByRole("button", { name: "Not now", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("button", { name: "Close weekly insights signup" })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    assert.equal(
      await launch.evaluate((el) => el === document.activeElement),
      true,
    );
    await launch.click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Email address", exact: true })
        .inputValue(),
      "audit@example.com",
    );
    await finish(s);
  }
});

test("touch layouts preserve usable map space and reachable navigation through every panel", async () => {
  for (const [width, height] of [[320, 568], [390, 844], [932, 430]]) {
    const s = await session({ width, height, touch: true });
    const { page } = s;
    await openMap(page);
    const header = await page.locator(".topbar").boundingBox();
    const timeline = await page.locator(".timeline-toggle").boundingBox();
    assert.ok(timeline.y - (header.y + header.height) >= 180, "At least 180px of unobstructed map, even on small phones");
    assert.equal(await page.locator(".day-rail").isVisible(), false);
    assert.equal(await page.locator(".tab-bar button:visible").count(), 5);

    await page.getByRole("combobox", { name: "Lookback window", exact: true }).selectOption("14");
    await page.waitForURL(/days=14/);
    await page.locator(".timeline-toggle").tap();
    assert.equal(await page.locator(".day-rail").isVisible(), true);
    await page.getByRole("button", { name: "New", exact: true }).tap();
    await page.waitForURL(/mode=new/);
    await page.locator(".timeline-toggle").tap();
    assert.equal(await page.locator(".day-rail").isVisible(), false);

    for (const [tab, title] of [["Weekly roundup", "Weekly roundup"], ["Insights", "Insights"], ["Ask", "Ask Flockline"], ["My birds", "My birds"]]) {
      await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: tab, exact: true }).tap();
      const panel = page.getByRole("dialog", { name: title, exact: true });
      // WebKit can resolve animation.finished before painting its final frame.
      await panel.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const box = await panel.boundingBox();
      const nav = await page.locator(".tab-bar").boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= nav.y + 1, `Panel stays above navigation at ${width}x${height}, ${tab}: ${JSON.stringify({ box, nav })}`);
      assert.ok(nav.y + nav.height <= height + 1, "Navigation stays inside viewport");
      assert.equal(await page.locator(".app-body").evaluate((el) => el.inert), true);
    }
    await page.getByRole("button", { name: "Map", exact: true }).tap();
    await page.getByRole("button", { name: "States and filters", exact: true }).tap();
    await page.getByRole("button", { name: "Close Map settings", exact: true }).tap();
    await page.getByRole("combobox", { name: "Map region", exact: true }).selectOption("west");
    await page.waitForURL(/region=west/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await finish(s);
  }
});

test("touch users can select a bird, open its map record, save it and return to the map", async () => {
  const s = await session({ width: 390, height: 844, touch: true });
  const { page } = s;
  await openMap(page);
  await page.locator(".masthead-title").tap();
  await page.getByRole("textbox", { name: "Species name or eBird species code" }).fill("Bald Eagle");
  await page.locator(".picker-results button").filter({ hasText: "Bald Eagle" }).tap();
  await page.waitForURL(/bird=baleag/);
  await page.waitForFunction(() => document.querySelector(".masthead-meta")?.textContent.includes("1 location"));
  const point = await page.evaluate(() => {
    const map = window.__flocklineMap;
    const marker = map.latLngToContainerPoint([41.3, -72.95]);
    const bounds = map.getContainer().getBoundingClientRect();
    return { x: bounds.x + marker.x, y: bounds.y + marker.y };
  });
  await page.touchscreen.tap(point.x, point.y);
  await page.getByRole("complementary", { name: "Sighting details" }).waitFor();
  const record = await page.locator(".sighting-sheet").boundingBox();
  const nav = await page.locator(".tab-bar").boundingBox();
  assert.ok(record.y + record.height < nav.y, "Sighting never covers navigation");
  await page.locator(".sighting-sheet").getByRole("button", { name: "Watch", exact: true }).tap();
  await page.getByRole("button", { name: /^My birds/ }).tap();
  assert.ok((await page.getByRole("dialog", { name: "My birds" }).innerText()).includes("Bald Eagle"));
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  assert.equal(await page.locator(".sighting-sheet").count(), 0);
  await finish(s);
});

test("phone panels and search stay usable when the visible viewport shrinks or rotates", async () => {
  const s = await session({ width: 390, height: 844, touch: true });
  const { page } = s;
  await openMap(page);
  await page.getByRole("button", { name: "Ask", exact: true }).tap();
  await page.getByRole("textbox", { name: "Ask the Flockline assistant" }).tap();
  // The browser reports the visible area above the keyboard through this same
  // viewport resize path. This verifies layout, not an actual OS keyboard.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.getByRole("textbox", { name: "Ask the Flockline assistant" }).fill("Where are birds nearby?");
  // Measure the painted layout after the sheet animation and viewport update,
  // just as the other phone panel geometry check does above.
  await page.locator(".drawer").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const composer = await page.locator(".chat-composer").boundingBox();
  const nav = await page.locator(".tab-bar").boundingBox();
  assert.ok(composer.y >= 0 && composer.y + composer.height <= nav.y + 1);
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  await page.locator(".masthead-title").tap();
  await page.getByRole("textbox", { name: "Species name or eBird species code" }).fill("eagle");
  await page.locator(".picker-results button").filter({ hasText: "Bald Eagle" }).tap();
  await page.setViewportSize({ width: 932, height: 430 });
  await page.getByRole("button", { name: "Insights", exact: true }).tap();
  assert.equal(await page.locator(".app").evaluate((el) => el.classList.contains("docked")), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  assert.equal(await page.locator(".mobile-header").isVisible(), true);
  await finish(s);
});

test("phone search and signup follow an offset visual viewport above the keyboard", async () => {
  const s = await session({ width: 390, height: 844, touch: true });
  const { page } = s;
  await openMap(page);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 380 });
    Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, get: () => 100 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.locator(".masthead-title").tap();
  const picker = await page.locator(".picker").boundingBox();
  const close = await page.locator(".picker-close").boundingBox();
  assert.ok(picker.y >= 100 && picker.y + picker.height <= 480);
  assert.ok(close.y >= 100 && close.y + close.height <= 480);
  await page.locator(".picker-close").tap();
  await page.locator(".digest-header .digest-cta").tap();
  const signup = await page.getByRole("dialog", { name: "Weekly insights signup", exact: true }).boundingBox();
  assert.ok(signup.y >= 100 && signup.y + signup.height <= 480);
  await finish(s);
});

test("signup validates editions, freezes submitted values, and recovers from API failure", async () => {
  let sent;
  let fail = true;
  const s = await session({
    handlers: {
      "/api/digest-subscription": async (route) => {
        sent = route.request().postDataJSON();
        await delay(200);
        return json(
          route,
          fail ? { error: "Please try again shortly." } : { ok: true },
          fail ? 503 : 200,
        );
      },
    },
  });
  const { page } = s;
  await page.goto(base + "/newsletter?region=west&src=audit");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("audit@example.com");
  await page.getByRole("checkbox", { name: "West", exact: true }).uncheck();
  assert.equal(
    await page
      .getByRole("button", { name: "Get the free digest", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("checkbox", { name: "Northeast", exact: true }).check();
  await page
    .getByRole("button", { name: "Get the free digest", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .inputValue(),
    "audit@example.com",
  );
  fail = false;
  await page
    .getByRole("button", { name: "Get the free digest", exact: true })
    .click();
  await page.getByText("Check your inbox", { exact: true }).waitFor();
  assert.deepEqual(sent.regions, ["northeast"]);
  assert.equal(sent.src, "audit");
  assert.match(
    await page.locator(".digest-success-content").innerText(),
    /audit@example.com/,
  );
  await finish(s);
});

test("phone discovery starts nationwide, exposes regional buttons, and carries the chosen edition into signup", async () => {
  const s = await session({ width: 390, height: 844, touch: true });
  const { page } = s;
  await page.goto(base + "/");
  await page.waitForURL(/region=nationwide/);
  // A saved regional map and a separately pinned Insights scope must not trap
  // a fresh discovery action inside either selection.
  await page.goto(base + "/?bird=browse&region=northeast&iregion=west");
  await page.getByRole("button", { name: "Explore notable sightings", exact: true }).tap();
  await page.locator(".insight-card").first().waitFor();
  assert.equal(await page.locator(".map-empty").count(), 0, "Welcome card leaves the map when a panel opens");
  const regions = page.getByRole("group", { name: "Insights region", exact: true });
  assert.equal(await regions.getByRole("button", { name: "National", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(new URL(page.url()).searchParams.get("region"), "nationwide");
  assert.equal(await page.evaluate(() => {
    const bounds = window.__flocklineMap.getBounds();
    return bounds.contains([34.05, -118.24]) && bounds.contains([40.71, -74]);
  }), true, "Discovery frames the country, including both coasts");
  await regions.getByRole("button", { name: "West", exact: true }).tap();
  await page.getByRole("heading", { name: `Finding for ${US_REGION_PRESETS.find((r) => r.id === "west").stateCodes[0]}`, exact: true }).waitFor();
  assert.equal(await regions.getByRole("button", { name: "West", exact: true }).getAttribute("aria-pressed"), "true");
  await regions.getByRole("button", { name: "National", exact: true }).tap();
  await page.locator(".insight-card").first().waitFor();
  await page.locator(".insight-digest-invitation").tap();
  await page.waitForURL("**/newsletter?**");
  assert.equal(new URL(page.url()).searchParams.get("region"), "nationwide");
  assert.equal(new URL(page.url()).searchParams.get("src"), "insights");
  await page.getByRole("link", { name: "Get the free digest", exact: true }).tap();
  assert.equal(await page.getByRole("checkbox", { name: "Nationwide", exact: true }).isChecked(), true);
  const form = await page.locator("#subscribe").boundingBox();
  assert.ok(form.y >= 0 && form.y < 60, "Phone signup shortcut brings the form into view");
  await finish(s);
});

test("newsletter previews stay dated, handle region races and failures, and preserve edited signup preferences", async () => {
  let generationRequests = 0;
  const s = await session({ width: 320, height: 700, handlers: {
    "/api/roundup": (route) => { generationRequests++; return json(route, {}); },
    "/api/roundup-archive": async (route, url) => {
      const scope = url.searchParams.get("scope");
      if (scope === "west") await delay(300);
      if (scope === "midwest") return json(route, { error: "Temporarily unavailable" }, 503);
      return json(route, { ...roundup(scope), generatedAt: "2026-09-07T14:00:00Z", findings: [{
        title: `Saved ${scope} bird`, comName: "Baird's Sandpiper", locName: "Published location",
        image: { url: "/digest-illustrations/baisan-v1.jpg", kind: "species-illustration", alt: "Baird's Sandpiper illustration" },
      }] });
    },
  } });
  const { page } = s;
  await page.goto(base + "/newsletter?region=northeast");
  await page.getByRole("heading", { name: "Saved northeast bird", exact: true }).waitFor();
  assert.equal(await page.locator(".issue-preview time").getAttribute("datetime"), "2026-09-07");
  assert.equal(await page.locator(".issue-preview-link").getAttribute("href"), "/roundup/northeast/2026-09-07");
  assert.match(await page.locator(".issue-preview figcaption").innerText(), /not the reported individual/);
  assert.equal(await page.evaluate(() => document.querySelector(".methodology").scrollWidth <= window.innerWidth), true);
  const selector = page.getByRole("combobox", { name: "Preview an edition", exact: true });
  await selector.selectOption("west");
  await selector.selectOption("south");
  await page.getByRole("heading", { name: "Saved south bird", exact: true }).waitFor();
  await delay(350);
  assert.equal(await page.getByRole("heading", { name: "Saved west bird", exact: true }).count(), 0);
  assert.equal(await page.getByRole("checkbox", { name: "South", exact: true }).isChecked(), true);
  await page.getByRole("checkbox", { name: "Northeast", exact: true }).check();
  await selector.selectOption("midwest");
  await page.locator(".issue-preview").getByText("Browse published issues to see what lands in your inbox.").waitFor();
  assert.equal(await page.locator(".issue-preview-title").count(), 0, "An unavailable edition does not show another region's bird");
  assert.equal(await page.getByRole("checkbox", { name: "South", exact: true }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Northeast", exact: true }).isChecked(), true);
  assert.equal(generationRequests, 0, "Looking at a sample never generates a new digest");
  await finish(s);
});

test("newsletter keeps the published sample readable when its illustration fails", async () => {
  const s = await session({ handlers: {
    "/api/roundup-archive": (route) => json(route, {
      ...roundup("northeast"), generatedAt: "2026-09-07T14:00:00Z", findings: [{
        title: "A saved sighting", locName: "Published location",
        image: { kind: "species-illustration", url: "/missing-illustration.jpg", alt: "Bird illustration" },
      }],
    }),
  } });
  const { page } = s;
  await page.route("**/missing-illustration.jpg", (route) => route.abort());
  await page.goto(base + "/newsletter?region=northeast");
  await page.getByRole("heading", { name: "A saved sighting", exact: true }).waitFor();
  await page.locator(".issue-preview-link").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector(".issue-preview figure"));
  assert.equal(await page.locator(".issue-preview-title").innerText(), "A saved sighting");
  assert.equal(await page.locator(".issue-preview-link").getAttribute("href"), "/roundup/northeast/2026-09-07");
  await finish(s);
});

test("history restores defaults, empty states, and the weekly edition", async () => {
  const s = await session();
  const { page } = s;
  await openMap(page);
  await page.locator(".tab-insights").click();
  await page
    .getByRole("group", { name: "Insights region" })
    .getByRole("button", { name: "West", exact: true }).click();
  await page
    .locator(".window-pills")
    .getByRole("button", { name: "30D", exact: true })
    .click();
  await page.locator(".tab-birds").click();
  await page
    .locator(".window-pills")
    .getByRole("button", { name: "7D", exact: true })
    .click();
  await page.goBack();
  assert.equal(
    await page.getByRole("group", { name: "Insights region" }).getByRole("button", { name: "West", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .locator(".window-pills")
      .getByRole("button", { name: "30D", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.goBack();
  assert.equal(await page.locator(".drawer").count(), 0);
  assert.equal(
    await page
      .locator(".window-pills")
      .getByRole("button", { name: "7D", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".tab-insights").click();
  assert.equal(
    await page.getByRole("group", { name: "Insights region" }).getByRole("button", { pressed: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Weekly roundup", exact: true })
    .click();
  await page
    .getByRole("button", { name: "West 13 states", exact: true })
    .click();
  await page.locator(".roundup-list .insight-card").first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("edition"), "west");
  const url = page.url();
  await page.reload();
  await page.locator(".roundup-list .insight-card").first().waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Weekly roundup region" })
      .inputValue(),
    "west",
  );
  assert.equal(page.url(), url);
  await page.locator(".menu-pill").click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.reload();
  assert.equal(new URL(page.url()).searchParams.get("states"), "none");
  assert.match(
    await page.locator(".drawer").innerText(),
    /Select at least one state/,
  );
  await page.locator(".tab-insights").click();
  await page
    .getByText(
      "Choose a region above or select states in Menu to load Insights.",
    )
    .waitFor();
  await finish(s);
});

test("scope changes immediately clear old dots and recover after clearing states mid-request", async () => {
  let slow = false;
  const s = await session({
    handlers: {
      "/api/sightings": async (route, url) => {
        if (slow) await delay(800);
        return json(route, sightings(url));
      },
    },
  });
  const { page } = s;
  await openMap(page);
  slow = true;
  await page.locator(".menu-pill").click();
  await page.getByRole("checkbox", { name: /Hotspots only/ }).check();
  assert.equal(
    await page.locator(".sighting-index button").count(),
    0,
    "Previous filters do not remain on the map",
  );
  await delay(450);
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page
    .getByRole("button", { name: "Close Map settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pick states", exact: true })
    .waitFor();
  assert.equal(await page.locator(".map-note.loading").count(), 0);
  await delay(900);
  assert.equal(
    await page.locator(".sighting-index button").count(),
    0,
    "Aborted response cannot restore old dots",
  );
  await finish(s);
});

test("slow Insights responses cannot appear beneath a different region", async () => {
  const requests = [];
  const s = await session({
    handlers: {
      "/api/insights": async (route, url) => {
        requests.push(url.search);
        if (url.searchParams.get("regions") === "US-CT") await delay(1800);
        return json(route, insights(url));
      },
    },
  });
  const { page } = s;
  await openMap(page);
  await page.locator(".tab-insights").click();
  await page.waitForRequest((r) => r.url().includes("/api/insights"));
  await page
    .getByRole("group", { name: "Insights region" })
    .getByRole("button", { name: "West", exact: true }).click();
  await page
    .getByRole("heading", {
      name: `Finding for ${US_REGION_PRESETS.find((r) => r.id === "west").stateCodes[0]}`,
      exact: true,
    })
    .waitFor();
  await delay(2000);
  assert.equal(
    await page
      .getByRole("heading", { name: "Finding for US-CT", exact: true })
      .count(),
    0,
  );
  assert.ok(
    requests.some((q) =>
      q.includes(US_REGION_PRESETS.find((r) => r.id === "west").stateCodes[0]),
    ),
  );
  await finish(s);
});

test("typing Enter before a new search resolves never selects the previous result", async () => {
  const s = await session({
    handlers: {
      "/api/species": async (route, url) => {
        const q = url.searchParams.get("q");
        if (q === "zzzz") await delay(700);
        return json(route, { items: q === "Osprey" ? [osprey] : [] });
      },
    },
  });
  const { page } = s;
  await page.goto(base + "/?bird=browse");
  await page.locator(".masthead-title").click();
  const input = page.getByRole("textbox", {
    name: "Species name or eBird species code",
  });
  await input.fill("Osprey");
  await page.locator(".picker-results button").waitFor();
  await input.fill("zzzz");
  await input.press("Enter");
  assert.equal(
    await page.getByRole("dialog", { name: "Choose a species" }).count(),
    1,
  );
  assert.equal(new URL(page.url()).searchParams.get("bird"), "browse");
  await page
    .getByText("No birds match that search.", { exact: true })
    .waitFor();
  await finish(s);
});

test("configuration failure keeps the map controls usable", async () => {
  const s = await session({
    handlers: {
      "/api/config": (route) => json(route, { error: "Temporary outage" }, 503),
    },
  });
  await s.page.goto(base + "/?bird=browse");
  await s.page.getByText("Data status unavailable", { exact: true }).waitFor();
  await s.page.locator(".masthead-title").click();
  await s.page
    .getByRole("button", { name: "Osprey osprey", exact: true })
    .waitFor();
  await finish(s);
});

test("archive retries transient failures and rejects malformed issue links", async () => {
  let count = 0;
  let failing = true;
  const s = await session({
    handlers: {
      "/api/roundup-archive": (route) => {
        count++;
        return json(
          route,
          failing
            ? { error: "Temporary outage" }
            : { issues: [{ scopeId: "west", date: "2026-08-24" }] },
          failing ? 502 : 200,
        );
      },
    },
  });
  const { page } = s;
  await page.goto(base + "/roundup");
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  failing = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("link", { name: "Week ending August 24, 2026", exact: true })
    .waitFor();
  const validRequests = count;
  for (const path of [
    "/roundup/atlantis",
    "/roundup/west/not-a-date",
    "/roundup/west/2026-02-30",
    "/roundup/west/2026-08-24/extra",
    "/missing",
  ]) {
    await page.goto(base + path);
    await page
      .getByRole("heading", { name: "Page not found", exact: true })
      .waitFor();
  }
  assert.equal(
    count,
    validRequests,
    "Invalid paths never fetch a different edition",
  );
  await finish(s);
});

test("keyboard skip link and panel close preserve useful focus", async () => {
  const s = await session();
  const { page } = s;
  await openMap(page);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator(".drawer")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator(".skip-link")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator(".tab-birds").click();
  await page.getByRole("button", { name: "+ Osprey", exact: true }).click();
  await page.reload();
  await page
    .locator(".drawer")
    .getByRole("button", { name: "Remove Osprey from My birds", exact: true })
    .waitFor();
  await finish(s);
});

test("Ask restores failed questions and does not move the map after the reader leaves", async () => {
  let fail = true;
  const s = await session({
    handlers: {
      "/api/chat": async (route) => {
        await delay(600);
        return json(
          route,
          fail
            ? { error: "Ask is temporarily unavailable." }
            : {
                reply: "Here is the requested bird.",
                speciesRefs: [],
                mapAction: {
                  speciesCode: "baleag",
                  comName: "Bald Eagle",
                  lat: 41.3,
                  lng: -72.95,
                  regionCode: "US-CT",
                },
              },
          fail ? 503 : 200,
        );
      },
    },
  });
  const { page } = s;
  await openMap(page);
  await page.locator(".tab-ask").click();
  const composer = page.getByRole("textbox", {
    name: "Ask the Flockline assistant",
  });
  await composer.fill("Show me a Bald Eagle");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText("Ask is temporarily unavailable.", { exact: true })
    .first()
    .waitFor();
  assert.equal(await composer.inputValue(), "Show me a Bald Eagle");
  assert.equal(await page.locator(".chat-msg.user").count(), 0);
  fail = false;
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".tab-birds").click();
  await delay(800);
  assert.equal(new URL(page.url()).searchParams.get("bird"), "osprey");
  await page.locator(".tab-ask").click();
  await page
    .getByText("Here is the requested bird.", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.locator(".chat-msg.user").count(), 1);
  await finish(s);
});

test("timeline counts follow the selected day and field records have a keyboard exit", async () => {
  const s = await session();
  const { page } = s;
  await openMap(page);
  await page.getByRole("slider", { name: "Timeline day" }).focus();
  await page.keyboard.press("Home");
  assert.equal(await page.locator(".sighting-index button").count(), 0);
  await page.keyboard.press("End");
  await page.locator(".sighting-index button").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator(".sighting-sheet")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .locator(".sighting-sheet a")
      .filter({ hasText: "Checklist" })
      .getAttribute("href"),
    "https://ebird.org/checklist/S12345",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sighting-sheet").count(), 0);
  assert.equal(
    await page
      .locator(".sighting-index button")
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .locator(".window-pills")
    .getByRole("button", { name: "1D", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Play timeline", exact: true })
      .isDisabled(),
    true,
  );
  await finish(s);
});

const sightingFixture = {
  reporting: { timing: "published", scopeLabel: "Northeast", back: 7, asOf: "2026-09-26T20:00:00Z", partial: false, reports: [
    { subId: "S123456789", observedAt: "2026-09-21 08:49", locName: "Audit coast", count: "1" },
    { subId: "S123456790", observedAt: "2026-09-22 09:00", locName: "Another coast", count: "2" },
  ] },
  finding: { kind: "rarity", speciesCode: "osprey", comName: "Osprey", sciName: "Pandion haliaetus", subId: "S123456789", locName: "Audit coast", detail: "27 notable Osprey reports across 2 states, with up to 2 birds in a single report." },
  checklist: { subId: "S123456789", observedAt: "2026-09-21 08:49", observerName: "Audit observer", protocolLabel: "Traveling", durationMinutes: 40, distanceKm: 0.12, numObservers: 1, numSpecies: 7, observation: { count: "1", media: { photos: 2 } } },
  observationExcerpt: "One bird fishing along the coast.", checklistExcerpt: "",
  media: { status: "ready", photos: [
    { assetId: "12345678", speciesCode: "osprey", subId: "S123456789", credit: "Audit observer", match: "checklist" },
    { assetId: "12345679", speciesCode: "osprey", subId: "S123456789", credit: "Audit observer", match: "checklist" },
  ] },
};
test("phone sighting pages open from titles and Learn more, show photos and notes, and reload directly", async () => {
  for (const [width, touch] of [[1280, false], [320, true]]) {
    const s = await session({ width, height: 844, touch, handlers: { "/api/sighting": (route) => json(route, sightingFixture) } });
    const { page } = s;
    await page.goto(base + "/?bird=browse&region=northeast&view=insights");
    await page.locator(".insight-card").first().waitFor();
    assert.equal(await page.locator(".insight-card h3 a").first().getAttribute("href"), "/sightings/S123456789/osprey");
    assert.equal(await page.getByRole("link", { name: "Learn more →", exact: true }).first().getAttribute("href"), "/sightings/S123456789/osprey");
    await page.locator(".insight-card h3 a").first().click();
    await page.getByRole("heading", { name: "Osprey", exact: true }).waitFor();
    assert.match(await page.locator("blockquote").innerText(), /One bird fishing/);
    assert.match(await page.getByRole("complementary", { name: "Reported bird count" }).innerText(), /1 bird reported/);
    assert.equal(await page.getByText("1 bird reported", { exact: true }).count(), 1);
    assert.equal((await page.locator("body").innerText()).includes("27 notable"), false);
    const reporting = page.getByRole("region", { name: "Reporting frequency" });
    assert.match(await reporting.innerText(), /2 reported sightings/);
    assert.match(await reporting.innerText(), /On 2 eBird checklists/);
    assert.equal(await reporting.getByRole("link").count(), 0);
    await reporting.locator("summary").click();
    assert.equal(await reporting.getByRole("link").count(), 2);
    assert.equal(await reporting.getByRole("link", { name: "Another coast" }).getAttribute("href"), "https://ebird.org/checklist/S123456790");
    assert.match(await reporting.innerText(), /September 22, 2026 · 9:00 AM local time · 2 birds/);
    assert.equal(await page.getByText("Birders on the outing", { exact: true }).isVisible(), false);
    await page.locator(".sighting-checklist-details summary").click();
    assert.equal(await page.getByText("Birders on the outing", { exact: true }).isVisible(), true);
    assert.match(await page.locator(".sighting-checklist-details").innerText(), /1 person/);
    assert.match(await page.locator(".sighting-checklist-details").innerText(), /7 different species/);
    assert.equal(await page.getByRole("link", { name: "Open featured checklist", exact: true }).getAttribute("href"), "https://ebird.org/checklist/S123456789");
    assert.equal(await page.locator("iframe").getAttribute("src"), "https://macaulaylibrary.org/asset/12345678/embed");
    await page.getByRole("button", { name: "Photo 2", exact: true }).click();
    assert.equal(await page.locator("iframe").getAttribute("src"), "https://macaulaylibrary.org/asset/12345679/embed");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Photo and facts fit the viewport");
    await page.reload();
    await page.getByRole("heading", { name: "Osprey", exact: true }).waitFor();
    await page.getByRole("link", { name: "Back to sightings", exact: true }).click();
    await page.locator(".insight-card").first().waitFor();
    await finish(s);
  }
});
test("sighting failure can retry without leaving the detail page", async () => {
  let available = false;
  const s = await session({ handlers: { "/api/sighting": (route) => available ? json(route, sightingFixture) : json(route, {}, 502) } });
  await s.page.goto(base + "/sightings/S123456789/osprey");
  await s.page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  available = true;
  await s.page.getByRole("button", { name: "Try again", exact: true }).click();
  await s.page.getByRole("heading", { name: "Osprey", exact: true }).waitFor();
  await finish(s);
});
