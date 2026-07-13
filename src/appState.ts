export type TimelineMode = "daily" | "cumulative";

export type AppState = {
  speciesCode: string | null;
  lookbackDays: number;
  regions: string[];
  timelineMode: TimelineMode;
  includeProvisional: boolean;
  hotspotsOnly: boolean;
};

const DEFAULT_DAYS = 7;

export function parseAppState(search: string, validRegions: string[]): Partial<AppState> {
  const params = new URLSearchParams(search);
  const bird = params.get("bird")?.trim().toLowerCase();
  const days = Number.parseInt(params.get("days") ?? "", 10);
  const requestedRegions = (params.get("states") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) => validRegions.includes(value) && values.indexOf(value) === index);

  return {
    ...(bird ? { speciesCode: bird === "browse" ? null : bird } : {}),
    ...(Number.isFinite(days) ? { lookbackDays: clamp(days, 1, 30) } : {}),
    ...(params.has("states") ? { regions: requestedRegions } : {}),
    ...(params.get("mode") === "new" ? { timelineMode: "daily" as const } : {}),
    ...(params.get("mode") === "trail" ? { timelineMode: "cumulative" as const } : {}),
    ...(params.has("provisional") ? { includeProvisional: params.get("provisional") !== "0" } : {}),
    ...(params.has("hotspots") ? { hotspotsOnly: params.get("hotspots") === "1" } : {})
  };
}

export function buildAppUrl(input: string, state: AppState, allRegions: string[]) {
  const url = new URL(input);
  const params = new URLSearchParams();

  params.set("bird", state.speciesCode ?? "browse");
  if (state.lookbackDays !== DEFAULT_DAYS) {
    params.set("days", String(state.lookbackDays));
  }
  if (!sameRegions(state.regions, allRegions)) {
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
