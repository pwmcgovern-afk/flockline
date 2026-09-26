import { load } from "cheerio";
import { put } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { readSightingRecord } from "./sightingStore.js";

const verified = JSON.parse(
  readFileSync(
    new URL("../shared/verifiedSightingPhotos.json", import.meta.url),
    "utf8",
  ),
);
const cache = new Map();
const validId = (id) => /^\d{6,15}$/.test(String(id));

export function parseChecklistPhotos(html, subId, speciesCode) {
  const $ = load(html);
  // A challenge, login page, or changed markup is an unavailable lookup,
  // never evidence that the observer uploaded no photos.
  if (!$("h1").text().includes(subId) || !$(`[id="${speciesCode}"]`).length)
    return null;
  const photos = [];
  $(`[data-media-speciescode="${speciesCode}"][data-media-mediatype="P"]`).each(
    (_index, element) => {
      const assetId = $(element).attr("data-media-id");
      if (
        !validId(assetId) ||
        photos.some((photo) => photo.assetId === assetId)
      )
        return;
      photos.push({
        assetId,
        speciesCode,
        subId,
        credit:
          $(element).attr("data-media-userdisplayname") || "eBird contributor",
      });
    },
  );
  return photos.slice(0, 6);
}

export async function getSightingMedia(
  subId,
  speciesCode,
  photoCount,
  { fetcher = fetch, read = readSightingRecord, blobPut = put } = {},
) {
  const key = `${subId}/${speciesCode}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const known = verified.filter(
    (photo) => photo.subId === subId && photo.speciesCode === speciesCode,
  );
  let saved = null;
  if (!known.length && photoCount > 0) {
    try {
      saved = await read(`sighting-media/${key}.json`);
    } catch {
      /* Fresh lookup can still succeed. */
    }
  }
  let photos = known.length
    ? known
    : saved?.photos?.filter(
        (photo) =>
          validId(photo.assetId) &&
          photo.subId === subId &&
          photo.speciesCode === speciesCode,
      ) || [];
  let status = photos.length
    ? "ready"
    : photoCount === 0
      ? "none"
      : "unavailable";
  // Cornell serves these public photo references in its checklist markup.
  // No login cookies, challenge solving, or photo copies are used here.
  if (photoCount > 0 && !photos.length) {
    try {
      const response = await fetcher(`https://ebird.org/checklist/${subId}`, {
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(4500),
      });
      const parsed = response.ok
        ? parseChecklistPhotos(await response.text(), subId, speciesCode)
        : null;
      if (parsed?.length) {
        photos = parsed;
        status = "ready";
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          await blobPut(
            `sighting-media/${key}.json`,
            JSON.stringify({ photos }),
            {
              abortSignal: AbortSignal.timeout(3000),
              access: "public",
              contentType: "application/json",
              addRandomSuffix: false,
              allowOverwrite: true,
            },
          ).catch((error) =>
            console.error("Photo reference save failed", error.message),
          );
        }
      }
    } catch {
      /* The rest of the report remains available if Cornell is slow. */
    }
  }
  // Reference photographs are explicitly distinguished from this observation.
  const reference = photos.length
    ? []
    : verified
        .filter(
          (photo) => photo.speciesCode === speciesCode && photo.subId !== subId,
        )
        .slice(0, 1);
  const value = {
    status,
    photos: photos.length
      ? photos.map((photo) => ({ ...photo, match: "checklist" }))
      : reference.map((photo) => ({ ...photo, match: "species" })),
  };
  if (cache.size >= 300) cache.delete(cache.keys().next().value);
  cache.set(key, {
    value,
    expires: Date.now() + (status === "unavailable" ? 60000 : 900000),
  });
  return value;
}
