import { getChecklistDetails } from "./ebirdCore.js";
import { getSightingMedia, verifiedSightingPhotos } from "./sightingMedia.js";

const DAY_MS = 86_400_000;
const validChecklist = (value) => /^S\d{6,15}$/.test(value || "");

function calendarDay(value) {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

function uniquePhotos(photos) {
  const seen = new Set();
  return photos.filter((photo) => {
    if (seen.has(photo.assetId)) return false;
    seen.add(photo.assetId);
    return true;
  }).slice(0, 6);
}

// Nearby names or coordinates cannot establish a shared eBird location. Only
// an exact source location ID and a bounded observation-date window qualify.
export function createRelatedMediaLookup({
  getChecklist = getChecklistDetails,
  getMedia = getSightingMedia,
  verified = verifiedSightingPhotos,
  now = Date.now,
  timeoutMs = 2500,
  maxEntries = 200,
} = {}) {
  const cache = new Map();
  return async function getRelatedMedia({ checklist, speciesCode, reporting }) {
    const featuredDay = calendarDay(checklist?.observedAt);
    const locId = checklist?.locId;
    if (featuredDay === null || !/^L\d+$/.test(locId || "") || !speciesCode) return [];
    const inWindow = (value) => {
      const day = calendarDay(value);
      return day !== null && day <= featuredDay && day >= featuredDay - 7 * DAY_MS;
    };
    const matches = (photo) => photo.speciesCode === speciesCode && photo.locId === locId
      && validChecklist(photo.subId) && photo.subId !== checklist.subId && inWindow(photo.observedAt)
      && /^\d{6,15}$/.test(String(photo.assetId));
    const known = verified.filter(matches).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    if (known.length) return uniquePhotos(known).map((photo) => ({ ...photo, match: "location" }));

    const key = `${checklist.subId}/${speciesCode}/${locId}/${featuredDay}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.photos;
    const candidates = [...new Map((Array.isArray(reporting?.reports) ? reporting.reports : [])
      .filter((report) => validChecklist(report?.subId) && report.subId !== checklist.subId
        && report.locId === locId && (!report.speciesCode || report.speciesCode === speciesCode)
        && inWindow(report.observedAt))
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .map((report) => [report.subId, report])).values()].slice(0, 3);

    const controller = new AbortController();
    const completed = [];
    const foundPhotos = () => uniquePhotos(completed.flat());
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(foundPhotos()); }, timeoutMs);
      timer.unref?.();
    });
    const discover = async () => {
      // At most three existing reports, never a new regional feed. All calls
      // share the same deadline and failed checks do not mean photos are absent.
      await Promise.all(candidates.map(async (candidate, index) => {
        try {
          const detail = await getChecklist({ subId: candidate.subId, species: speciesCode }, undefined, { signal: controller.signal });
          controller.signal.throwIfAborted();
          const observation = detail?.observation;
          const matchesSpecies = observation?.speciesCode === speciesCode
            || observation?.reportAsSpeciesCode === speciesCode;
          if (detail?.subId !== candidate.subId || detail.locId !== locId || !inWindow(detail.observedAt)
            || !matchesSpecies || !(observation.media?.photos > 0)) return [];
          const media = await getMedia(candidate.subId, speciesCode, detail.observation.media.photos, {
            signal: controller.signal, taxonCode: detail.observation.speciesCode,
          });
          controller.signal.throwIfAborted();
          completed[index] = (media?.photos || []).filter((photo) => photo.match === "checklist"
            && photo.subId === candidate.subId && photo.speciesCode === speciesCode
            && /^\d{6,15}$/.test(String(photo.assetId))).map((photo) => ({
            ...photo, match: "location", locId, locName: candidate.locName,
            observedAt: detail.observedAt,
          }));
        } catch { return []; }
      }));
      return foundPhotos();
    };
    let photos;
    try { photos = await Promise.race([discover(), deadline]); }
    finally { clearTimeout(timer); }
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, { photos, expires: now() + (photos.length ? 900000 : 60000) });
    return photos;
  };
}

export const getRelatedSightingMedia = createRelatedMediaLookup();
