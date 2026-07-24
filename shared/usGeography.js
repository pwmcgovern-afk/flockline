// One authoritative geography model for the browser, API handlers, local
// server, demo data, and catalog tooling. Region membership follows the four
// U.S. Census Bureau regions and includes all 50 states plus Washington, D.C.

export const DEFAULT_REGION_ID = "northeast";

export const US_CENSUS_REGIONS = [
  {
    id: "northeast",
    name: "Northeast",
    stateCodes: ["US-ME", "US-NH", "US-VT", "US-MA", "US-RI", "US-CT", "US-NY", "US-NJ", "US-PA"]
  },
  {
    id: "midwest",
    name: "Midwest",
    stateCodes: ["US-ND", "US-SD", "US-NE", "US-KS", "US-MO", "US-IA", "US-MN", "US-WI", "US-IL", "US-MI", "US-IN", "US-OH"]
  },
  {
    id: "south",
    name: "South",
    stateCodes: [
      "US-MD", "US-DE", "US-DC", "US-VA", "US-WV", "US-KY", "US-TN", "US-NC", "US-SC",
      "US-GA", "US-FL", "US-AL", "US-MS", "US-AR", "US-LA", "US-OK", "US-TX"
    ]
  },
  {
    id: "west",
    name: "West",
    stateCodes: ["US-WA", "US-ID", "US-MT", "US-WY", "US-OR", "US-CA", "US-NV", "US-UT", "US-CO", "US-AZ", "US-NM", "US-AK", "US-HI"]
  }
];

export const US_STATES = [
  { code: "US-AL", abbr: "AL", name: "Alabama", center: [32.8067, -86.7911], censusRegion: "south" },
  { code: "US-AK", abbr: "AK", name: "Alaska", center: [61.3707, -152.4044], censusRegion: "west" },
  { code: "US-AZ", abbr: "AZ", name: "Arizona", center: [33.7298, -111.4312], censusRegion: "west" },
  { code: "US-AR", abbr: "AR", name: "Arkansas", center: [34.9697, -92.3731], censusRegion: "south" },
  { code: "US-CA", abbr: "CA", name: "California", center: [36.1162, -119.6816], censusRegion: "west" },
  { code: "US-CO", abbr: "CO", name: "Colorado", center: [39.0598, -105.3111], censusRegion: "west" },
  { code: "US-CT", abbr: "CT", name: "Connecticut", center: [41.6032, -73.0877], censusRegion: "northeast" },
  { code: "US-DE", abbr: "DE", name: "Delaware", center: [39.3185, -75.5071], censusRegion: "south" },
  { code: "US-DC", abbr: "DC", name: "District of Columbia", center: [38.9072, -77.0369], censusRegion: "south" },
  { code: "US-FL", abbr: "FL", name: "Florida", center: [27.7663, -81.6868], censusRegion: "south" },
  { code: "US-GA", abbr: "GA", name: "Georgia", center: [33.0406, -83.6431], censusRegion: "south" },
  { code: "US-HI", abbr: "HI", name: "Hawaii", center: [21.0943, -157.4983], censusRegion: "west" },
  { code: "US-ID", abbr: "ID", name: "Idaho", center: [44.2405, -114.4788], censusRegion: "west" },
  { code: "US-IL", abbr: "IL", name: "Illinois", center: [40.3495, -88.9861], censusRegion: "midwest" },
  { code: "US-IN", abbr: "IN", name: "Indiana", center: [39.8494, -86.2583], censusRegion: "midwest" },
  { code: "US-IA", abbr: "IA", name: "Iowa", center: [42.0115, -93.2105], censusRegion: "midwest" },
  { code: "US-KS", abbr: "KS", name: "Kansas", center: [38.5266, -96.7265], censusRegion: "midwest" },
  { code: "US-KY", abbr: "KY", name: "Kentucky", center: [37.6681, -84.6701], censusRegion: "south" },
  { code: "US-LA", abbr: "LA", name: "Louisiana", center: [31.1695, -91.8678], censusRegion: "south" },
  { code: "US-ME", abbr: "ME", name: "Maine", center: [44.6939, -69.3819], censusRegion: "northeast" },
  { code: "US-MD", abbr: "MD", name: "Maryland", center: [39.0639, -76.8021], censusRegion: "south" },
  { code: "US-MA", abbr: "MA", name: "Massachusetts", center: [42.4072, -71.3824], censusRegion: "northeast" },
  { code: "US-MI", abbr: "MI", name: "Michigan", center: [43.3266, -84.5361], censusRegion: "midwest" },
  { code: "US-MN", abbr: "MN", name: "Minnesota", center: [45.6945, -93.9002], censusRegion: "midwest" },
  { code: "US-MS", abbr: "MS", name: "Mississippi", center: [32.7416, -89.6787], censusRegion: "south" },
  { code: "US-MO", abbr: "MO", name: "Missouri", center: [38.4561, -92.2884], censusRegion: "midwest" },
  { code: "US-MT", abbr: "MT", name: "Montana", center: [46.9219, -110.4544], censusRegion: "west" },
  { code: "US-NE", abbr: "NE", name: "Nebraska", center: [41.1254, -98.2681], censusRegion: "midwest" },
  { code: "US-NV", abbr: "NV", name: "Nevada", center: [38.3135, -117.0554], censusRegion: "west" },
  { code: "US-NH", abbr: "NH", name: "New Hampshire", center: [43.6805, -71.5811], censusRegion: "northeast" },
  { code: "US-NJ", abbr: "NJ", name: "New Jersey", center: [40.0583, -74.4057], censusRegion: "northeast" },
  { code: "US-NM", abbr: "NM", name: "New Mexico", center: [34.8405, -106.2485], censusRegion: "west" },
  { code: "US-NY", abbr: "NY", name: "New York", center: [42.9538, -75.5268], censusRegion: "northeast" },
  { code: "US-NC", abbr: "NC", name: "North Carolina", center: [35.6301, -79.8064], censusRegion: "south" },
  { code: "US-ND", abbr: "ND", name: "North Dakota", center: [47.5289, -99.784], censusRegion: "midwest" },
  { code: "US-OH", abbr: "OH", name: "Ohio", center: [40.3888, -82.7649], censusRegion: "midwest" },
  { code: "US-OK", abbr: "OK", name: "Oklahoma", center: [35.5653, -96.9289], censusRegion: "south" },
  { code: "US-OR", abbr: "OR", name: "Oregon", center: [44.572, -122.0709], censusRegion: "west" },
  { code: "US-PA", abbr: "PA", name: "Pennsylvania", center: [41.2033, -77.1945], censusRegion: "northeast" },
  { code: "US-RI", abbr: "RI", name: "Rhode Island", center: [41.5801, -71.4774], censusRegion: "northeast" },
  { code: "US-SC", abbr: "SC", name: "South Carolina", center: [33.8569, -80.945], censusRegion: "south" },
  { code: "US-SD", abbr: "SD", name: "South Dakota", center: [44.2998, -99.4388], censusRegion: "midwest" },
  { code: "US-TN", abbr: "TN", name: "Tennessee", center: [35.7478, -86.6923], censusRegion: "south" },
  { code: "US-TX", abbr: "TX", name: "Texas", center: [31.0545, -97.5635], censusRegion: "south" },
  { code: "US-UT", abbr: "UT", name: "Utah", center: [40.15, -111.8624], censusRegion: "west" },
  { code: "US-VT", abbr: "VT", name: "Vermont", center: [44.0459, -72.7107], censusRegion: "northeast" },
  { code: "US-VA", abbr: "VA", name: "Virginia", center: [37.7693, -78.17], censusRegion: "south" },
  { code: "US-WA", abbr: "WA", name: "Washington", center: [47.4009, -121.4905], censusRegion: "west" },
  { code: "US-WV", abbr: "WV", name: "West Virginia", center: [38.4912, -80.9545], censusRegion: "south" },
  { code: "US-WI", abbr: "WI", name: "Wisconsin", center: [44.2685, -89.6165], censusRegion: "midwest" },
  { code: "US-WY", abbr: "WY", name: "Wyoming", center: [42.756, -107.3025], censusRegion: "west" }
];

const stateByCode = new Map(US_STATES.map((state) => [state.code, state]));
const regionById = new Map(US_CENSUS_REGIONS.map((region) => [region.id, region]));

export function getState(code) {
  return stateByCode.get(String(code || "").toUpperCase()) ?? null;
}

export function getCensusRegion(id) {
  return regionById.get(String(id || "").toLowerCase()) ?? null;
}

export function statesForRegion(id) {
  const region = getCensusRegion(id);
  return region ? region.stateCodes.map((code) => stateByCode.get(code)).filter(Boolean) : [];
}

export function matchingCensusRegion(stateCodes) {
  const normalized = [...new Set(stateCodes)].sort();
  return US_CENSUS_REGIONS.find((region) => {
    const expected = [...region.stateCodes].sort();
    return normalized.length === expected.length && expected.every((code, index) => code === normalized[index]);
  }) ?? null;
}
