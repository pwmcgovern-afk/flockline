import { settleWithConcurrency } from "./asyncPool.js";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_REQUEST_TIMEOUT_MS = 8_000;
const IMAGE_LOOKUP_CONCURRENCY = 3;
const IMAGE_WIDTH = 960;
const USER_AGENT = "Flockline/1.0 (https://flockline.app; pwmcgovern@gmail.com)";

const imageCache = new Map();

export async function addBirdImages(roundup, options = {}) {
  const findings = Array.isArray(roundup?.findings) ? roundup.findings : [];
  if (!findings.length) {
    return roundup;
  }

  const settled = await settleWithConcurrency(
    findings,
    IMAGE_LOOKUP_CONCURRENCY,
    (finding) => resolveBirdImage(finding, options)
  );

  return {
    ...roundup,
    findings: findings.map((finding, index) => {
      const result = settled[index];
      return result?.status === "fulfilled" && result.value
        ? { ...finding, image: result.value }
        : finding;
    })
  };
}

export async function resolveBirdImage(finding, {
  fetchImpl = globalThis.fetch,
  cache = imageCache,
  now = Date.now()
} = {}) {
  const scientificName = String(finding?.sciName || "").trim();
  const commonName = String(finding?.comName || finding?.title || "").trim();
  const articleTitle = scientificName || commonName;
  if (!articleTitle || typeof fetchImpl !== "function") {
    return null;
  }

  const cacheKey = String(finding?.speciesCode || articleTitle).trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.createdAt < IMAGE_CACHE_TTL_MS) {
    return cached.value;
  }

  const pageImage = await getWikipediaPageImage(articleTitle, fetchImpl);
  const value = pageImage
    ? await getCommonsImage(pageImage, commonName || articleTitle, fetchImpl)
    : null;
  cache.set(cacheKey, { createdAt: now, value });
  return value;
}

async function getWikipediaPageImage(articleTitle, fetchImpl) {
  const url = new URL(WIKIPEDIA_API);
  setSearchParams(url, {
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "pageimages",
    piprop: "name",
    pilicense: "free",
    titles: articleTitle
  });

  const payload = await fetchJson(url, fetchImpl);
  return payload?.query?.pages?.find((page) => page?.pageimage)?.pageimage || null;
}

async function getCommonsImage(fileName, commonName, fetchImpl) {
  const url = new URL(COMMONS_API);
  setSearchParams(url, {
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(IMAGE_WIDTH),
    iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms",
    titles: `File:${fileName}`
  });

  const payload = await fetchJson(url, fetchImpl);
  const info = payload?.query?.pages?.find((page) => page?.imageinfo?.length)?.imageinfo?.[0];
  const imageUrl = safeHttpsUrl(info?.thumburl, "upload.wikimedia.org");
  const sourceUrl = safeHttpsUrl(info?.descriptionurl, "commons.wikimedia.org");
  if (!imageUrl || !sourceUrl) {
    return null;
  }

  const metadata = info.extmetadata || {};
  const creator = plainText(metadata.Artist?.value || metadata.Credit?.value) || "Wikimedia contributor";
  const license = plainText(metadata.LicenseShortName?.value || metadata.UsageTerms?.value) || "free license";

  return {
    url: imageUrl,
    sourceUrl,
    creator,
    license,
    licenseUrl: safeHttpsUrl(metadata.LicenseUrl?.value),
    alt: `${commonName} bird photograph`,
    sourceName: "Wikimedia Commons"
  };
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Bird image lookup failed with ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function setSearchParams(url, params) {
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
}

function safeHttpsUrl(value, requiredHost) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || (requiredHost && url.hostname !== requiredHost)) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
