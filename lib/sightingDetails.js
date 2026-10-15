import { getChecklistDetails, getRecentSightingReporting, speciesPresets } from "./ebirdCore.js";
import { addBirdIllustrations } from "./birdIllustrations.js";
import { sightingPath } from "../shared/sightingPath.js";
import { readSightingRecord } from "./sightingStore.js";
import { getSightingMedia } from "./sightingMedia.js";
import { getRelatedSightingMedia } from "./relatedSightingMedia.js";
import { factualFinding } from "../shared/findingCopy.js";
import { loadAnnualHistory } from "./annualHistory.js";
import { loadHistoricalBaseline } from "./historicalBaseline.js";
import { normalizeHistoricalBaseline } from "../shared/historicalFrequency.js";
import { getHotspotContext } from "./locationContext.js";

export function excerpt(value, maxWords = 25) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.slice(0, maxWords).join(" ") + (words.length > maxWords ? "…" : "")
  );
}

export async function getSightingDetails(
  query,
  {
    getChecklist = getChecklistDetails,
    read = readSightingRecord,
    getMedia = getSightingMedia,
    getRelatedMedia = getRelatedSightingMedia,
    getReporting = getRecentSightingReporting,
    illustrate = addBirdIllustrations,
    getLocation = getHotspotContext,
    getBaseline = loadHistoricalBaseline,
  } = {},
) {
  const subId = String(query?.subId || "");
  const speciesCode = String(query?.species || "");
  const path = sightingPath({ subId, speciesCode });
  if (!path)
    throw Object.assign(new Error("Invalid sighting address."), {
      statusCode: 400,
    });
  const [checklist, saved] = await Promise.all([
    getChecklist({ subId, species: speciesCode }),
    read(`${path.slice(1)}.json`).catch(() => null),
  ]);
  if (!checklist.observation || checklist.subId !== subId) {
    throw Object.assign(new Error("This bird is not on that checklist."), {
      statusCode: 404,
    });
  }
  const species = speciesPresets.find(
    (item) => item.speciesCode === speciesCode,
  );
  const { reporting: savedReporting, ...savedFinding } = saved || {};
  const sourceLocationChanged = Boolean(checklist.locId && savedFinding.locId && checklist.locId !== savedFinding.locId);
  if (sourceLocationChanged) {
    // A corrected checklist location invalidates its old geographic context.
    for (const key of [
      "locName", "region", "regionName", "regionCode", "countyCode", "countyName",
      "subnational2Code", "lat", "lng", "historicalBaseline",
    ]) delete savedFinding[key];
  }
  const finding = factualFinding({
    ...savedFinding,
    subId,
    speciesCode,
    locId: checklist.locId || savedFinding.locId,
    comName: saved?.comName || species?.comName || speciesCode,
    sciName: saved?.sciName || species?.sciName || "",
    obsDt: checklist.observedAt || saved?.obsDt,
  }, { count: checklist.observation.count });
  const [exactMedia, reporting, location] = await Promise.all([
    getMedia(subId, speciesCode, checklist.observation.media.photos, {
      taxonCode: checklist.observation.speciesCode,
    }),
    savedReporting || getReporting(finding).catch(() => null),
    finding.locName && (finding.countyCode || finding.subnational2Code)
      ? null
      : getLocation(checklist.locId).catch(() => null),
  ]);
  let media = exactMedia;
  if (!media.photos.some((photo) => photo.match === "checklist")) {
    const related = await getRelatedMedia({ checklist, speciesCode, reporting }).catch(() => []);
    if (related.length) media = { ...media, photos: related };
  }
  if (location) {
    // Fill missing facts only. Saved place names remain the publication record
    // unless the source checklist now identifies a different location.
    for (const [key, value] of Object.entries(location)) if (!finding[key]) finding[key] = value;
    Object.assign(finding, factualFinding(finding, { count: checklist.observation.count }));
  }
  // Keep the published baseline version while its observation date still
  // matches. A corrected source date or new county coverage needs a new lookup.
  const sameObservationDate = Boolean(saved?.obsDt)
    && String(saved.obsDt).slice(0, 10) === String(finding.obsDt).slice(0, 10);
  if (finding.historicalBaseline?.status !== "available" || !sameObservationDate) {
    finding.historicalBaseline = await getBaseline(finding);
  }
  // Correct interpretation of an old export value without rewriting its source.
  finding.historicalBaseline = await loadAnnualHistory(normalizeHistoricalBaseline(finding.historicalBaseline));
  const illustrated =
    !media.photos.length && !finding.image
      ? await illustrate({ findings: [finding] })
      : { findings: [finding] };
  // Limit the combined quoted text from one checklist, keeping the species
  // observation first and making its attribution explicit in the page.
  const observationExcerpt = excerpt(checklist.observation.comments);
  const usedWords = observationExcerpt
    ? observationExcerpt.split(/\s+/).length
    : 0;
  const checklistExcerpt = excerpt(
    checklist.checklistComments,
    Math.max(0, 25 - usedWords),
  );
  return {
    finding: illustrated.findings[0],
    reporting,
    checklist: {
      ...checklist,
      checklistComments: null,
      observation: { ...checklist.observation, comments: null },
    },
    observationExcerpt,
    checklistExcerpt: usedWords < 25 ? checklistExcerpt : "",
    media,
  };
}
