const PROTOCOL_LABELS = {
  P20: "Incidental",
  P21: "Traveling",
  P22: "Stationary",
  P23: "Area count"
};

export function normalizeChecklistDetails(raw, speciesCode) {
  const observations = Array.isArray(raw?.obs) ? raw.obs : [];
  const observation = observations.find((item) => item?.speciesCode === speciesCode) || null;
  const breeding = Array.isArray(observation?.obsAux)
    ? observation.obsAux.find((item) => item?.fieldName === "breeding_code")
    : null;
  const protocolId = cleanText(raw?.protocolId, 32);

  return {
    subId: cleanText(raw?.subId, 32),
    locId: cleanText(raw?.locId, 48),
    observedAt: cleanText(raw?.obsDt, 48),
    observerName: cleanText(raw?.userDisplayName, 160),
    protocolId,
    protocolLabel: protocolId ? PROTOCOL_LABELS[protocolId] || `eBird protocol ${protocolId}` : null,
    durationMinutes: hoursToMinutes(raw?.durationHrs),
    distanceKm: finiteNumber(raw?.effortDistanceKm),
    numObservers: nonnegativeInteger(raw?.numObservers),
    numSpecies: nonnegativeInteger(raw?.numSpecies) ?? uniqueSpeciesCount(observations),
    allObsReported: typeof raw?.allObsReported === "boolean" ? raw.allObsReported : null,
    checklistComments: cleanText(raw?.subComments, 2400),
    observation: observation
      ? {
          speciesCode: cleanText(observation.speciesCode, 32) || speciesCode,
          count: observationCount(observation),
          comments: cleanText(observation.obsComments, 2400),
          breedingCode: cleanText(breeding?.auxCode || breeding?.value, 32),
          exoticCategory: cleanText(observation.exoticCategory, 64),
          media: {
            photos: mediaCount(observation.photoCounts),
            audio: mediaCount(observation.audioCounts),
            videos: mediaCount(observation.videoCounts)
          }
        }
      : null
  };
}

function observationCount(observation) {
  const display = cleanText(observation?.howManyStr, 32);
  if (display) {
    return display;
  }
  const atLeast = finiteNumber(observation?.howManyAtleast);
  const atMost = finiteNumber(observation?.howManyAtmost);
  if (atLeast !== null && atMost !== null && atLeast !== atMost) {
    return `${atLeast}-${atMost}`;
  }
  if (atLeast !== null) {
    return String(atLeast);
  }
  return observation?.present ? "X" : null;
}

function hoursToMinutes(value) {
  const hours = finiteNumber(value);
  return hours === null ? null : Math.round(hours * 60);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nonnegativeInteger(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function uniqueSpeciesCount(observations) {
  const species = new Set(observations.map((item) => item?.speciesCode).filter(Boolean));
  return species.size || null;
}

function mediaCount(value) {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + (finiteNumber(item?.count ?? item) || 0), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + (finiteNumber(item) || 0), 0);
  }
  return nonnegativeInteger(value) || 0;
}

function cleanText(value, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}
