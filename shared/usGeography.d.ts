export type CensusRegionId = "northeast" | "midwest" | "south" | "west";
export type RegionPresetId = CensusRegionId | "nationwide";

export type CensusRegion = {
  id: CensusRegionId;
  name: string;
  stateCodes: string[];
};

export type USRegionPreset = {
  id: RegionPresetId;
  name: string;
  stateCodes: string[];
};

export type USState = {
  code: string;
  abbr: string;
  name: string;
  center: [number, number];
  censusRegion: CensusRegionId;
};

export const DEFAULT_REGION_ID: CensusRegionId;
export const US_CENSUS_REGIONS: CensusRegion[];
export const US_STATES: USState[];
export const US_NATIONWIDE_REGION: USRegionPreset;
export const US_REGION_PRESETS: USRegionPreset[];
export function getState(code: string): USState | null;
export function getCensusRegion(id: string): CensusRegion | null;
export function getRegionPreset(id: string): USRegionPreset | null;
export function statesForRegion(id: string): USState[];
export function matchingCensusRegion(stateCodes: string[]): CensusRegion | null;
export function matchingRegionPreset(stateCodes: string[]): USRegionPreset | null;
