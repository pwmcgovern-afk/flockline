// Only source-issued eBird identifiers belong in a public sighting URL.
export function sightingPath(finding) {
  const subId = String(finding?.subId || "");
  const speciesCode = String(finding?.speciesCode || "");
  return /^S\d{6,15}$/.test(subId) && /^[a-z0-9-]{2,32}$/.test(speciesCode)
    ? `/sightings/${subId}/${speciesCode}`
    : null;
}

export function parseSightingPath(pathname) {
  const match = String(pathname)
    .replace(/\/+$/, "")
    .match(/^\/sightings\/(S\d{6,15})\/([a-z0-9-]{2,32})$/);
  return match ? { subId: match[1], speciesCode: match[2] } : null;
}
