const locationCache = new Map();
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

// Resolve only an exact public hotspot. Personal locations, missing metadata,
// and upstream failures stay unknown rather than borrowing a nearby county.
export async function getHotspotContext(
  locId,
  {
    apiKey = process.env.EBIRD_API_KEY,
    fetcher = fetch,
    cache = locationCache,
    now = Date.now,
    timeoutMs = 2000,
  } = {},
) {
  if (!/^L\d{1,15}$/.test(String(locId || "")) || !apiKey) return null;
  const cached = cache.get(locId);
  if (cached?.expiresAt > now()) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let value = null;
  try {
    const response = await fetcher(
      `https://api.ebird.org/v2/ref/hotspot/info/${encodeURIComponent(locId)}`,
      {
        headers: { "x-ebirdapitoken": apiKey, accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (response.ok) {
      const location = await response.json();
      const countyCode = String(location?.subnational2Code || "");
      const countyName = String(location?.subnational2Name || "").trim();
      if (location?.locId === locId && location.isHotspot === true) {
        const locName = typeof location.locName === "string" ? location.locName.trim().slice(0, 300) : "";
        const regionCode = String(location.subnational1Code || "");
        const region = typeof location.subnational1Name === "string" ? location.subnational1Name.trim().slice(0, 160) : "";
        const hasCounty = /^US-[A-Z]{2}-\d{3}$/.test(countyCode) && countyName;
        if (locName || hasCounty) value = {
          locId,
          ...(locName ? { locName } : {}),
          ...(hasCounty ? { countyCode, countyName } : {}),
          ...(/^US-[A-Z]{2}$/.test(regionCode) && region ? { regionCode, region } : {}),
        };
      }
    }
  } catch {
    // Geographic context is optional and must not prevent a checklist opening.
  } finally {
    clearTimeout(timer);
  }
  cache.delete(locId);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(locId, { value, expiresAt: now() + (value ? SUCCESS_TTL_MS : MISS_TTL_MS) });
  return value;
}

// Nearby-report callers only need a county. Keep that narrower contract while
// sighting pages reuse the same cached public-hotspot response for its name.
export async function getHotspotCounty(locId, options) {
  const location = await getHotspotContext(locId, options);
  return location?.countyCode
    ? { countyCode: location.countyCode, countyName: location.countyName }
    : null;
}
