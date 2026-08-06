export type TimelineMode = "daily" | "cumulative";

// Which drawer the URL opens into. "map" is the bare map with no drawer.
export type AppView = "map" | "insights" | "ask" | "birds";

export type AppState = {
  speciesCode: string | null;
  lookbackDays: number;
  regions: string[];
  timelineMode: TimelineMode;
  includeProvisional: boolean;
  hotspotsOnly: boolean;
  // Insights carry their own scope so a link can point at "rare birds in the
  // West over the past 3 days" without disturbing whatever the map is showing.
  // null on either field means "follow the map".
  view?: AppView;
  insightRegions?: string[] | null;
  insightBack?: number | null;
};

const DEFAULT_DAYS = 7;
const DEFAULT_REGION_ID = "northeast";
const VIEWS: AppView[] = ["map", "insights", "ask", "birds"];

type RegionPreset = {
  id: string;
  stateCodes: string[];
};

export function parseAppState(
  search: string,
  validRegions: string[],
  regionPresets: RegionPreset[] = []
): Partial<AppState> {
  const params = new URLSearchParams(search);
  const bird = params.get("bird")?.trim().toLowerCase();
  const days = Number.parseInt(params.get("days") ?? "", 10);
  const requestedPreset = params.get("region")?.trim().toLowerCase();
  const presetRegions = regionPresets
    .find((preset) => preset.id === requestedPreset)
    ?.stateCodes.filter((code) => validRegions.includes(code));
  const requestedRegions = (params.get("states") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) => validRegions.includes(value) && values.indexOf(value) === index);

  const view = params.get("view")?.trim().toLowerCase();
  const insightBack = Number.parseInt(params.get("iback") ?? "", 10);
  const insightPresetRegions = regionPresets
    .find((preset) => preset.id === params.get("iregion")?.trim().toLowerCase())
    ?.stateCodes.filter((code) => validRegions.includes(code));
  const insightStates = (params.get("istates") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) => validRegions.includes(value) && values.indexOf(value) === index);

  return {
    ...(bird ? { speciesCode: bird === "browse" ? null : bird } : {}),
    ...(Number.isFinite(days) ? { lookbackDays: clamp(days, 1, 30) } : {}),
    // Only honour a states list that resolved to something. A link written as
    // ?states=CT,MA instead of US-CT,US-MA drops every code, and committing the
    // empty result made "no states selected" the reader's saved preference, so
    // every later visit to the bare domain opened on an empty map.
    ...(presetRegions
      ? { regions: presetRegions }
      : requestedRegions.length
        ? { regions: requestedRegions }
        : {}),
    ...(params.get("mode") === "new" ? { timelineMode: "daily" as const } : {}),
    ...(params.get("mode") === "trail" ? { timelineMode: "cumulative" as const } : {}),
    ...(params.has("provisional") ? { includeProvisional: params.get("provisional") !== "0" } : {}),
    ...(params.has("hotspots") ? { hotspotsOnly: params.get("hotspots") === "1" } : {}),
    ...(VIEWS.includes(view as AppView) ? { view: view as AppView } : {}),
    ...(Number.isFinite(insightBack) ? { insightBack: clamp(insightBack, 1, 30) } : {}),
    ...(insightPresetRegions
      ? { insightRegions: insightPresetRegions }
      : insightStates.length
        ? { insightRegions: insightStates }
        : {})
  };
}

export function buildAppUrl(
  input: string,
  state: AppState,
  allRegions: string[],
  regionPresets: RegionPreset[] = []
) {
  const url = new URL(input);
  const params = new URLSearchParams();
  const matchingPreset = regionPresets.find((preset) => sameRegions(state.regions, preset.stateCodes));

  params.set("bird", state.speciesCode ?? "browse");
  if (state.lookbackDays !== DEFAULT_DAYS) {
    params.set("days", String(state.lookbackDays));
  }
  if (matchingPreset && matchingPreset.id !== DEFAULT_REGION_ID) {
    params.set("region", matchingPreset.id);
  } else if (!matchingPreset && !sameRegions(state.regions, allRegions)) {
    params.set("states", state.regions.join(","));
  }
  if (state.timelineMode === "daily") {
    params.set("mode", "new");
  }
  if (!state.includeProvisional) {
    params.set("provisional", "0");
  }
  if (state.hotspotsOnly) {
    params.set("hotspots", "1");
  }
  if (state.view && state.view !== "map") {
    params.set("view", state.view);
  }
  // Only serialize an insights scope that actually differs from the map's, so
  // ordinary map links stay short and a shared insights link stays explicit.
  if (state.insightBack && state.insightBack !== state.lookbackDays) {
    params.set("iback", String(state.insightBack));
  }
  if (state.insightRegions && !sameRegions(state.insightRegions, state.regions)) {
    const insightPreset = regionPresets.find((preset) => sameRegions(state.insightRegions as string[], preset.stateCodes));
    if (insightPreset) {
      params.set("iregion", insightPreset.id);
    } else {
      params.set("istates", state.insightRegions.join(","));
    }
  }

  url.search = params.toString();
  url.hash = "";
  return url.toString();
}

function sameRegions(selected: string[], all: string[]) {
  return selected.length === all.length && all.every((region) => selected.includes(region));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
