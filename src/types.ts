export type Region = {
  code: string;
  abbr: string;
  name: string;
  center: [number, number];
};

export type Species = {
  speciesCode: string;
  comName: string;
  sciName: string;
  group: string;
};

export type SightingProperties = {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId?: string;
  locName: string;
  obsDt: string;
  howMany: number | null;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId?: string;
  regionCode: string;
};

export type SightingFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: SightingProperties;
};

export type SightingsResponse = {
  source: "ebird" | "demo";
  cached?: boolean;
  species: Species;
  back: number;
  regions: string[];
  generatedAt: string;
  featureCollection: {
    type: "FeatureCollection";
    features: SightingFeature[];
  };
  stats: {
    sightings: number;
    checklists: number;
    regionCounts: Record<string, number>;
    latestObsDt: string | null;
  };
};

export type ConfigResponse = {
  hasApiKey: boolean;
  states: Region[];
  presets: Species[];
  maxBackDays: number;
};

export type InsightKind = "rarity" | "wide" | "surge";

export type Insight = {
  kind: InsightKind;
  title: string;
  detail: string;
  speciesCode?: string;
  comName?: string;
  locName?: string;
  region?: string;
  obsDt?: string;
  subId?: string;
  generatedBy?: "llm" | "template";
};

export type InsightsResponse = {
  generatedAt: string;
  source: "ebird" | "demo";
  generator: "llm" | "template";
  cached?: boolean;
  back: number;
  regions: string[];
  findings: Insight[];
};
