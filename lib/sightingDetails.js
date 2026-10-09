import { getChecklistDetails, getRecentSightingReporting, speciesPresets } from "./ebirdCore.js";
import { addBirdIllustrations } from "./birdIllustrations.js";
import { sightingPath } from "../shared/sightingPath.js";
import { readSightingRecord } from "./sightingStore.js";
import { getSightingMedia } from "./sightingMedia.js";

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
    getReporting = getRecentSightingReporting,
    illustrate = addBirdIllustrations,
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
  const finding = {
    ...savedFinding,
    subId,
    speciesCode,
    comName: saved?.comName || species?.comName || speciesCode,
    sciName: saved?.sciName || species?.sciName || "",
  };
  const [media, reporting] = await Promise.all([
    getMedia(subId, speciesCode, checklist.observation.media.photos, {
      taxonCode: checklist.observation.speciesCode,
    }),
    savedReporting || getReporting(finding).catch(() => null),
  ]);
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
