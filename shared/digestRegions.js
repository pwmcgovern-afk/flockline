import { US_REGION_PRESETS } from "./usGeography.js";

// The weekly email product deliberately mirrors the five roundup editions in
// the app. Keep the environment-variable names here as well, so setup tooling,
// signup confirmation, and the cron sender cannot silently disagree.
const topicEnvironmentByRegion = {
  nationwide: "RESEND_TOPIC_NATIONWIDE",
  northeast: "RESEND_TOPIC_NORTHEAST",
  midwest: "RESEND_TOPIC_MIDWEST",
  south: "RESEND_TOPIC_SOUTH",
  west: "RESEND_TOPIC_WEST"
};

export const DIGEST_REGIONS = US_REGION_PRESETS.map((region) => ({
  id: region.id,
  name: region.name,
  topicEnvironment: topicEnvironmentByRegion[region.id]
}));

const digestRegionById = new Map(DIGEST_REGIONS.map((region) => [region.id, region]));

export function getDigestRegion(id) {
  return digestRegionById.get(String(id || "").trim().toLowerCase()) ?? null;
}

export function normalizeDigestRegionIds(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(
    input
      .map((id) => String(id || "").trim().toLowerCase())
      .filter((id) => digestRegionById.has(id))
  )];
}
