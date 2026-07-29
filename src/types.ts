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

export type ChecklistDetailsResponse = {
  source: "ebird";
  cached?: boolean;
  subId: string | null;
  locId: string | null;
  observedAt: string | null;
  observerName: string | null;
  protocolId: string | null;
  protocolLabel: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  numObservers: number | null;
  numSpecies: number | null;
  allObsReported: boolean | null;
  checklistComments: string | null;
  observation: {
    speciesCode: string;
    count: string | null;
    comments: string | null;
    breedingCode: string | null;
    exoticCategory: string | null;
    media: {
      photos: number;
      audio: number;
      videos: number;
    };
  } | null;
};

export type SightingsResponse = {
  source: "ebird" | "demo";
  cached?: boolean;
  species: Species;
  back: number;
  regions: string[];
  coverage: {
    requestedRegions: string[];
    successfulRegions: string[];
    failedRegions: string[];
  };
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
  lat?: number | null;
  lng?: number | null;
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

export type ChatRole = "user" | "assistant";

export type ChatSpeciesRef = {
  speciesCode: string;
  comName: string;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  speciesRefs?: ChatSpeciesRef[];
};

// The assistant can drive the map: load a species and optionally zoom to a spot.
export type ChatMapAction = {
  speciesCode: string;
  comName: string;
  lat: number | null;
  lng: number | null;
  locName: string | null;
};

export type ChatResponse = {
  reply: string;
  speciesRefs: ChatSpeciesRef[];
  mapAction: ChatMapAction | null;
  toolsUsed: string[];
  generator: "llm" | "template";
  source: "ebird" | "demo";
};
