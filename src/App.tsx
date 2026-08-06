import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import {
  Bird,
  Bell,
  BellRing,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Compass,
  Database,
  ExternalLink,
  AudioLines,
  Link2,
  ListChecks,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Pause,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Send,
  Share2,
  Sparkles,
  Star,
  Feather,
  TrendingUp,
  UserRound,
  UsersRound,
  Video,
  X
} from "lucide-react";
import Tour, { type TourStep } from "./Tour";
import { buildAppUrl, parseAppState, type AppState, type AppView, type TimelineMode } from "./appState";
import {
  DEFAULT_REGION_ID,
  US_REGION_PRESETS,
  US_STATES,
  getCensusRegion,
  getRegionPreset,
  matchingRegionPreset
} from "../shared/usGeography.js";
import type {
  ChatMapAction,
  ChatMessage,
  ChatSpeciesRef,
  ChecklistDetailsResponse,
  ConfigResponse,
  Insight,
  InsightKind,
  InsightsResponse,
  Region,
  SightingFeature,
  SightingsResponse,
  Species
} from "./types";

const defaultStates: Region[] = US_STATES;
const defaultRegionCodes = getCensusRegion(DEFAULT_REGION_ID)?.stateCodes ?? [];

// Keep the initial client bundle lean. The full nationwide catalog arrives
// from /api/config immediately after mount; these familiar birds make the
// shell useful if that request is delayed or unavailable.
const defaultPresets: Species[] = [
  { speciesCode: "osprey", comName: "Osprey", sciName: "Pandion haliaetus", group: "Raptors" },
  { speciesCode: "baleag", comName: "Bald Eagle", sciName: "Haliaeetus leucocephalus", group: "Raptors" },
  { speciesCode: "comloo", comName: "Common Loon", sciName: "Gavia immer", group: "Waterbirds" },
  { speciesCode: "rthhum", comName: "Ruby-throated Hummingbird", sciName: "Archilochus colubris", group: "Backyard" },
  { speciesCode: "scatan", comName: "Scarlet Tanager", sciName: "Piranga olivacea", group: "Grosbeaks" },
  { speciesCode: "balori", comName: "Baltimore Oriole", sciName: "Icterus galbula", group: "Blackbirds" }
];
// Browse-tab order: most birder-salient groups first, the long tail after.
// Tabs are derived from whatever groups the catalog actually contains.
const groupOrder = [
  "Raptors", "Waterfowl", "Shorebirds", "Coastal", "Waders", "Waterbirds",
  "Warblers", "Sparrows", "Grosbeaks", "Blackbirds", "Flycatchers", "Vireos",
  "Woodpeckers", "Corvids", "Aerial", "Upland", "Owls", "Backyard", "Other"
];

// Ubiquitous species birders routinely don't bother logging, so eBird shows
// far fewer locations than where they actually are. We flag these in the UI.
const underreportedCommon = new Set([
  "amecro", "fiscro", "blujay", "amerob", "eursta", "houspa", "rocpig", "cangoo",
  "moudov", "rewbla", "comgra", "bnhcow", "mallar3", "dowwoo", "rebwoo", "bcchic",
  "tuftit", "whbnut", "norcar", "houfin", "amegfi", "ribgul", "amhgul1", "gbbgul1",
  "turvul", "doccor", "graycat", "carwre", "cedwax", "chiswi"
]);

const featuredSpeciesCodes = ["osprey", "baleag", "comloo", "rthhum", "scatan", "balori"];
const CATALOG_PREVIEW_LIMIT = 48;
// The accessible sighting list mirrors the plotted dots for keyboard and
// screen-reader users. Capped because each entry is a real focusable node and a
// wide window plots thousands of locations.
const ACCESSIBLE_SIGHTING_LIMIT = 100;
const BIRD_ART: Record<string, string> = Object.fromEntries(
  featuredSpeciesCodes.map((code) => [code, `/birds/${code}.jpg`])
);
const WATCHLIST_KEY = "flockline.watchlist.v1";
const ALERTS_KEY = "flockline.alerts.v1";
const PREFERENCES_KEY = "flockline.preferences.v1";
type ChecklistMedia = NonNullable<ChecklistDetailsResponse["observation"]>["media"];

// The lookback windows offered as presets. A 1..30 slider was too fiddly to
// land on a useful number, and these are the windows birders actually think in.
const WINDOW_PRESETS = [1, 3, 7, 14, 30];

// Far enough from the lower 48 that letting them set the frame costs every
// other state its legibility. Used only for framing, never to filter data.
const OFFSHORE_STATES = new Set(["US-AK", "US-HI"]);

// The catalog arrives grouped, and "Aerial" sorts first, so the picker's front
// door was 36 swifts, swallows and nightjars: 1,422 birds on file and not one
// a reader is likely to be looking for. Lead with the featured species, then
// take one from each group in turn so the opening screen spans the catalog.
// Order within a group is preserved, so the per-family tabs are unaffected.
function browseOrder(all: Species[], featured: Species[]): Species[] {
  const byCode = new Map(all.map((species) => [species.speciesCode, species]));
  const lead = featured
    .map((species) => byCode.get(species.speciesCode))
    .filter((species): species is Species => Boolean(species));
  const leadCodes = new Set(lead.map((species) => species.speciesCode));

  const groups = new Map<string, Species[]>();
  for (const species of all) {
    if (leadCodes.has(species.speciesCode)) {
      continue;
    }
    const key = species.group || "Other";
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(species);
    } else {
      groups.set(key, [species]);
    }
  }

  const queues = [...groups.values()];
  const rest: Species[] = [];
  for (let depth = 0; queues.some((queue) => depth < queue.length); depth += 1) {
    for (const queue of queues) {
      if (depth < queue.length) {
        rest.push(queue[depth]);
      }
    }
  }

  return [...lead, ...rest];
}

// The scrubber and the tab bar float over the map's lower edge, so padding a
// fit evenly buries the southern end of the data underneath them. Measure the
// band they actually occupy and keep the data clear of it. Falls back to a
// fixed guess when the chrome has not rendered yet.
function fitPadding(): L.FitBoundsOptions {
  const stage = document.querySelector(".stage");
  const box = stage?.getBoundingClientRect() ?? null;
  const overlays = [".scrubber", ".tab-bar"]
    .map((selector) => document.querySelector(selector))
    .filter((element): element is Element => Boolean(element));

  let bottom = 132;
  if (box && overlays.length) {
    bottom = Math.max(
      ...overlays.map((element) => box.bottom - element.getBoundingClientRect().top)
    );
  }

  // Leaflet subtracts padding from the box before solving for zoom, and falls
  // back to minZoom when what remains collapses. On a short phone the chrome
  // band is most of the map's height, so reserving all of it fitted the entire
  // world into a 320x568 screen. Cap the reservation at a third of the box:
  // better that a few dots sit under the scrubber than that none are readable.
  const height = box?.height ?? 0;
  const edge = height ? Math.min(28, Math.round(height * 0.06)) : 28;
  const budget = height ? Math.max(0, Math.round(height / 3) - edge) : 132;

  return {
    paddingTopLeft: [28, edge],
    paddingBottomRight: [28, Math.min(Math.max(bottom, 0), budget) + edge]
  };
}

// One drawer at a time, by construction: "menu" holds the region and filter
// controls, the rest are the three feature panels.
type DrawerId = Exclude<AppView, "map"> | "menu";

const DRAWER_TITLES: Record<DrawerId, string> = {
  menu: "Map settings",
  insights: "Insights",
  ask: "Ask Flockline",
  birds: "My birds"
};

// A pool the chat panel samples from on each open, so the starter questions
// feel fresh and hint at the range of things the assistant can answer.
const CHAT_PROMPTS = [
  "What rare birds have shown up in my selected states this week?",
  "Where can I see a Scarlet Tanager right now?",
  "Are Ospreys still active in the area?",
  "Show me notable sightings across my region",
  "What warblers are moving through right now?",
  "Where have Bald Eagles been seen recently?",
  "Any good shorebird spots active this week?",
  "What hummingbirds are around right now?",
  "What ducks are on the water right now?",
  "What should I look for this weekend?"
];
const REGIONAL_CHAT_PROMPTS: Record<string, string[]> = {
  nationwide: [
    "What unusual sightings stand out across the country?",
    "Where are Ospreys most active nationwide?",
    "What birds are moving across the U.S. right now?"
  ],
  northeast: [
    "What's being reported around Boston lately?",
    "Has anything rare turned up around New York?",
    "What's active along the New England coast?"
  ],
  midwest: [
    "What's being reported around Chicago lately?",
    "What is moving through the Great Lakes?",
    "Has anything rare turned up in the Midwest?"
  ],
  south: [
    "What's unusual on the Gulf Coast?",
    "What's the most active birding spot around Austin?",
    "Has anything rare turned up in Florida?"
  ],
  west: [
    "What's being reported around Seattle lately?",
    "Has anything rare turned up in California?",
    "What's active along the Pacific Coast?"
  ]
};

function samplePrompts(pool: string[], count: number) {
  const copy = [...pool];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy.slice(0, count);
}

// Versioned: the redesign moved every control, so returning readers should be
// walked through the new chrome once rather than being left to hunt for it.
const TOUR_SEEN_KEY = "flockline.tourSeen.v2";

// Walked through on first visit, and re-openable from the compass button.
// Steps whose target is hidden (the scrubber has no species loaded, the map
// tab on a narrow screen) are skipped automatically by Tour.
const TOUR_STEPS: TourStep[] = [
  {
    side: "center",
    title: "Welcome to Flockline",
    // Says "starting in" rather than a flat claim about coverage: the app
    // covers all fifty states but opens scoped to one region, and the old copy
    // promised the whole country while the map showed the Northeast.
    body: "A live map of where birds are being reported, drawn from eBird checklists. All fifty states are here; you are starting in one region. Here is the 30-second tour."
  },
  {
    target: ".masthead-title",
    side: "bottom",
    title: "Start with a bird",
    body: "The name at the top is the bird you are tracking. Click it to search the full nationwide catalog and switch species."
  },
  {
    target: ".window-pills",
    side: "bottom",
    title: "Choose how far back",
    body: "One day for what is happening right now, thirty for the shape of a migration. Everything on screen follows this window."
  },
  {
    target: ".tab-insights",
    side: "top",
    title: "Insights",
    body: "Rare and notable birds, written up from eBird's notable feed. Insights carry their own region and window, so you can share a link to one exact view."
  },
  {
    target: ".tab-ask",
    side: "top",
    title: "Ask anything",
    body: "Ask about recent sightings in plain language. Every answer is built from live eBird data, and it can drive the map for you."
  },
  {
    target: ".menu-pill",
    side: "left",
    title: "States and filters",
    body: "Menu is where you pick states or a whole region, and where the provisional and hotspot filters live."
  },
  {
    side: "center",
    title: "One honest caveat",
    body: "eBird returns one record per location, and common birds go under-reported because birders skip logging them. Read the counts as floors, not totals. Methodology has the full story."
  }
];

export default function App() {
  const initialState = useRef(
    buildInitialAppState()
  ).current;
  // Only an explicit ?bird= selects a species. A first visit opens on "Choose a
  // bird" rather than silently picking one, so the first thing on screen is the
  // reader's own choice instead of a default they didn't make.
  const initialSpecies = initialState.speciesCode
    ? defaultPresets.find((species) => species.speciesCode === initialState.speciesCode)
      ?? { speciesCode: initialState.speciesCode, comName: initialState.speciesCode, sciName: "", group: "Species" }
    : null;
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const sightingLayerRef = useRef<L.LayerGroup | null>(null);
  const sightingsRequestRef = useRef<AbortController | null>(null);
  const lastFitKeyRef = useRef("");
  // When the chat asks to zoom to a spot, the next data load flies here
  // instead of fitting to all sightings.
  const pendingFocusRef = useRef<{ lat: number; lng: number } | null>(null);
  // A camera move requested before the container had a real size. Leaflet
  // caches its size at creation time, so any fit issued against a 0x0 box
  // resolves to zoom 0 and never recovers on its own — that is what left the
  // map sitting on the whole world. We hold the request and replay it as soon
  // as the ResizeObserver reports a real box.
  const pendingFitRef = useRef<((map: L.Map) => void) | null>(null);
  const fitRetryRef = useRef<number | undefined>(undefined);
  // Scope key of the last insights request that failed. Without this, a
  // persistent /api/insights outage turns the auto-load effect's 700ms debounce
  // into an unbounded retry loop: each failure clears insightsLoading, which
  // re-runs the effect, which schedules another request. Explicit retry still
  // works via the Re-run and Update buttons.
  const failedInsightScopeRef = useRef<string | null>(null);
  // Focus target for the species search and the scroll container for the browse
  // grid, so clearing/selecting can bring the right thing into view.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const speciesGridRef = useRef<HTMLDivElement | null>(null);
  const mastheadRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [states, setStates] = useState(defaultStates);
  const [presets, setPresets] = useState(defaultPresets);
  const [selectedRegions, setSelectedRegions] = useState(
    initialState.regions ?? defaultRegionCodes
  );
  const [focusedRegionId, setFocusedRegionId] = useState(() => {
    return matchingRegionPreset(initialState.regions ?? defaultRegionCodes)?.id ?? DEFAULT_REGION_ID;
  });
  const [selectedSpecies, setSelectedSpecies] = useState<Species | null>(initialSpecies);
  const [speciesQuery, setSpeciesQuery] = useState(initialSpecies?.comName ?? "");
  const [suggestions, setSuggestions] = useState<Species[]>(defaultPresets);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const resolvedCodesRef = useRef(new Set<string>());
  const [speciesGroup, setSpeciesGroup] = useState("All");
  const [lookbackDays, setLookbackDays] = useState(initialState.lookbackDays ?? 7);
  const [selectedDayIndex, setSelectedDayIndex] = useState((initialState.lookbackDays ?? 7) - 1);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(initialState.timelineMode ?? "cumulative");
  const [playing, setPlaying] = useState(false);
  const [includeProvisional, setIncludeProvisional] = useState(initialState.includeProvisional ?? true);
  const [hotspotsOnly, setHotspotsOnly] = useState(initialState.hotspotsOnly ?? false);
  const [shareStatus, setShareStatus] = useState("");
  const [sightingShareStatus, setSightingShareStatus] = useState("");
  const [selectedSighting, setSelectedSighting] = useState<SightingFeature | null>(null);
  const [sightingDetails, setSightingDetails] = useState<ChecklistDetailsResponse | null>(null);
  const [sightingDetailsLoading, setSightingDetailsLoading] = useState(false);
  const [sightingDetailsError, setSightingDetailsError] = useState("");
  const [payload, setPayload] = useState<SightingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Exactly one drawer can be open, so opening one closes the others without
  // any coordination between three separate booleans.
  const [drawer, setDrawer] = useState<DrawerId | null>(
    initialState.view && initialState.view !== "map" ? initialState.view : null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  // Insights keep their own scope. null on either means "follow the map",
  // which is the default until the reader overrides it (or arrives on a link
  // that pins one).
  const [insightRegions, setInsightRegions] = useState<string[] | null>(initialState.insightRegions ?? null);
  const [insightBack, setInsightBack] = useState<number | null>(initialState.insightBack ?? null);
  const [insightLinkStatus, setInsightLinkStatus] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>(() => readStoredList(WATCHLIST_KEY));
  const [alerts, setAlerts] = useState<string[]>(() => readStoredList(ALERTS_KEY));
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  // Pending map action requested by the chat assistant (load species / zoom).
  const [pendingMapAction, setPendingMapAction] = useState<ChatMapAction | null>(null);
  // Wide screens dock the drawers (push the map over); narrow screens overlay.
  const [isWide, setIsWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 861px)").matches
  );

  useEffect(() => {
    setSightingDetails(null);
    setSightingDetailsError("");
    setSightingDetailsLoading(false);

    const subId = selectedSighting?.properties.subId;
    const speciesCode = selectedSighting?.properties.speciesCode;
    if (!subId || !speciesCode || !/^S\d+$/.test(subId)) {
      return;
    }

    const controller = new AbortController();
    setSightingDetailsLoading(true);
    const params = new URLSearchParams({ subId, species: speciesCode });

    void (async () => {
      try {
        const response = await fetch(`/api/checklist?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Extra eBird details are unavailable.");
        }
        setSightingDetails(await response.json());
      } catch (detailError) {
        if (detailError instanceof DOMException && detailError.name === "AbortError") {
          return;
        }
        setSightingDetailsError(detailError instanceof Error ? detailError.message : "Extra eBird details are unavailable.");
      } finally {
        if (!controller.signal.aborted) {
          setSightingDetailsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [selectedSighting]);

  // The scope insights actually run at: their own pinned region/window when the
  // reader has set one, otherwise whatever the map is showing.
  const effectiveInsightRegions = insightRegions ?? selectedRegions;
  const effectiveInsightBack = insightBack ?? lookbackDays;
  // Identity for a scope, used to tell "we already tried this and it failed"
  // from "the reader moved to a new scope".
  const insightScopeKey = `${effectiveInsightBack}|${[...effectiveInsightRegions].sort().join(",")}`;

  // `fresh` forces a regenerate past both the server's 6h cache and any CDN
  // copy (unique URL).
  const loadInsights = useCallback(
    async (options?: { fresh?: boolean }) => {
      if (!effectiveInsightRegions.length) {
        setInsightsError("Select at least one state for Insights.");
        return;
      }
      setInsightsLoading(true);
      setInsightsError("");
      try {
        const params = new URLSearchParams({
          back: String(effectiveInsightBack),
          regions: effectiveInsightRegions.join(",")
        });
        if (options?.fresh) {
          params.set("fresh", "1");
          params.set("_t", String(Date.now()));
        }
        const response = await fetch(`/api/insights?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Insights request failed.");
        }
        failedInsightScopeRef.current = null;
        setInsights(data);
      } catch (requestError) {
        // Remember which scope failed so the auto-load effect stops retrying it.
        failedInsightScopeRef.current = insightScopeKey;
        setInsightsError(requestError instanceof Error ? requestError.message : "Insights request failed.");
      } finally {
        setInsightsLoading(false);
      }
    },
    [effectiveInsightBack, effectiveInsightRegions, insightScopeKey]
  );

  const openDrawer = (id: DrawerId) => setDrawer((current) => (current === id ? null : id));

  // Always open the picker on the full catalog. Selecting a bird leaves its
  // name in the query, and carrying that over would open the picker filtered
  // down to the one species already selected.
  const openPicker = () => {
    setSpeciesQuery("");
    setPickerOpen(true);
  };

  // Back to the opening position: the whole country, no bird, default window,
  // nothing pinned. Getting here by hand meant clearing the species, opening
  // menu, choosing Nationwide, and resetting the Insights scope separately.
  const startOver = () => {
    clearSpecies();
    selectRegionPreset("nationwide");
    setLookbackDays(7);
    setTimelineMode("cumulative");
    setInsightRegions(null);
    setInsightBack(null);
    setDrawer(null);
    setPickerOpen(false);
    setError("");
  };

  // Send focus back to the masthead, so closing the picker with the keyboard
  // does not drop the caret onto <body>.
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    mastheadRef.current?.focus();
  }, []);

  // The picker claims aria-modal, so it has to behave like one: Escape closes
  // it from anywhere inside (not just the search field), and Tab cycles within
  // it instead of walking out to the chrome behind the backdrop.
  // Escape closes the drawer too. It used to only close the picker, so an
  // overlaying drawer had no keyboard exit at all.
  useEffect(() => {
    if (!drawer || pickerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = pickerRef.current;
      if (!root) {
        return;
      }
      const focusable = [...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePicker, pickerOpen]);

  // Every programmatic camera move goes through here so it can be deferred
  // until the container is measurable, and so no caller has to remember the
  // invalidateSize dance.
  //
  // The retry loop is deliberately timer-driven rather than relying only on the
  // ResizeObserver: observer callbacks are delivered through the rendering
  // pipeline, which is throttled in background tabs and headless runs — the
  // same throttling that makes animated Leaflet moves hang. A timer still fires
  // there, so the map reaches the right place either way.
  const runFit = useCallback((fit: (map: L.Map) => void) => {
    if (!mapRef.current) {
      return;
    }
    pendingFitRef.current = fit;
    window.clearTimeout(fitRetryRef.current);

    let attempt = 0;
    const attemptFit = () => {
      const map = mapRef.current;
      // A newer fit superseded this one; let that request drive instead.
      if (!map || pendingFitRef.current !== fit) {
        return;
      }
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      if (size.x && size.y) {
        pendingFitRef.current = null;
        fit(map);
        return;
      }
      attempt += 1;
      if (attempt > 8) {
        // Give up polling and leave it pending; the ResizeObserver applies it
        // if the container ever gets a real box.
        return;
      }
      fitRetryRef.current = window.setTimeout(attemptFit, 60 * attempt);
    };

    attemptFit();
  }, []);

  const dateKeys = useMemo(() => buildDateKeys(lookbackDays), [lookbackDays]);
  const selectedDateKey = dateKeys[selectedDayIndex] ?? dateKeys[dateKeys.length - 1] ?? todayKey();
  const earliestDateKey = dateKeys[0] ?? selectedDateKey;
  const allFeatures = payload?.featureCollection.features ?? [];

  // Locations bucketed by their most-recent report date (eBird returns one
  // record per location), aligned to dateKeys for the timeline histogram. A bar
  // means last reported that day, not arrived that day.
  const dailyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feature of payload?.featureCollection.features ?? []) {
      const day = feature.properties.obsDt.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return dateKeys.map((key) => counts.get(key) ?? 0);
  }, [payload, dateKeys]);
  const maxDaily = dailyCounts.reduce((max, count) => Math.max(max, count), 0);

  const visibleFeatures = useMemo(() => {
    return allFeatures.filter((feature) => {
      const observationDate = feature.properties.obsDt.slice(0, 10);
      if (timelineMode === "daily") {
        return observationDate === selectedDateKey;
      }
      return observationDate >= earliestDateKey && observationDate <= selectedDateKey;
    });
  }, [allFeatures, earliestDateKey, selectedDateKey, timelineMode]);

  // Leaflet paints the dots into a single canvas (preferCanvas), so no marker
  // has a DOM node of its own to focus or announce. The stage renders this list
  // as the accessible mirror of what is plotted, newest first.
  const accessibleSightings = useMemo(() => {
    return [...visibleFeatures]
      .sort((left, right) => right.properties.obsDt.localeCompare(left.properties.obsDt))
      .slice(0, ACCESSIBLE_SIGHTING_LIMIT);
  }, [visibleFeatures]);

  // One selection path, shared by the marker click and the accessible list.
  const selectSighting = useCallback((feature: SightingFeature) => {
    setSelectedSighting(feature);
  }, []);

  const visibleStats = useMemo(() => {
    const checklists = new Set(visibleFeatures.map((feature) => feature.properties.subId).filter(Boolean));
    const reviewed = visibleFeatures.filter((feature) => feature.properties.obsReviewed).length;
    const latest = [...visibleFeatures]
      .map((feature) => feature.properties.obsDt)
      .filter(Boolean)
      .sort()
      .at(-1);

    return {
      sightings: visibleFeatures.length,
      checklists: checklists.size,
      reviewedRate: visibleFeatures.length ? Math.round((reviewed / visibleFeatures.length) * 100) : 0,
      latestObsDt: latest ?? payload?.stats.latestObsDt ?? null
    };
  }, [payload?.stats.latestObsDt, visibleFeatures]);

  // Whole-window totals (independent of New/Trail or the scrubbed day): the
  // count for the entire selected period. Birds sums each location's reported
  // count (a report with no number, "X", counts as at least 1).
  const windowStats = useMemo(() => {
    // Clamp to the timeline's own range. eBird returns a few records outside the
    // requested window, and counting them here made the header claim locations
    // the map could never plot at any scrubber position.
    const features = (payload?.featureCollection.features ?? []).filter((feature) => {
      const day = feature.properties.obsDt.slice(0, 10);
      return day >= earliestDateKey && day <= (dateKeys[dateKeys.length - 1] ?? day);
    });
    const birds = features.reduce(
      (sum, feature) => sum + Math.max(1, Number(feature.properties.howMany) || 0),
      0
    );
    return { locations: features.length, birds };
  }, [dateKeys, earliestDateKey, payload]);

  const selectedRegionLabels = useMemo(() => {
    return states.filter((state) => selectedRegions.includes(state.code)).map((state) => state.abbr);
  }, [selectedRegions, states]);
  const selectedRegionPreset = useMemo(() => matchingRegionPreset(selectedRegions), [selectedRegions]);
  const focusedRegion = useMemo(
    () => getRegionPreset(focusedRegionId) ?? getRegionPreset(DEFAULT_REGION_ID),
    [focusedRegionId]
  );
  const visibleRegionStates = useMemo(() => {
    const available = new Set(states.map((state) => state.code));
    return (focusedRegion?.stateCodes ?? [])
      .filter((code) => available.has(code))
      .map((code) => states.find((state) => state.code === code))
      .filter((state): state is Region => Boolean(state));
  }, [focusedRegion, states]);
  const selectedRegionSummary = selectedRegionPreset?.name
    ?? (selectedRegionLabels.length > 4
      ? `${selectedRegionLabels.length} states`
      : selectedRegionLabels.join(" ") || "No states selected");
  // The label for the scope insights are *currently pinned to*, which is not
  // necessarily the scope of the last response (that one is insights.scopeLabel).
  const insightRegionPreset = useMemo(
    () => matchingRegionPreset(effectiveInsightRegions),
    [effectiveInsightRegions]
  );
  const insightsScopeLabel = insightRegionPreset?.name
    ?? (effectiveInsightRegions.length > 4
      ? `${effectiveInsightRegions.length} states`
      : effectiveInsightRegions
          .map((code) => states.find((state) => state.code === code)?.abbr ?? code)
          .join(" ") || "No states selected");
  // The loaded findings no longer match the scope the controls are set to.
  const insightsStale = Boolean(
    insights
    && (insights.back !== effectiveInsightBack || !sameCodeSet(insights.regions, effectiveInsightRegions))
  );
  const insightsPinned = insightRegions !== null || insightBack !== null;
  const allStatesSelected = states.length > 0 && states.every((state) => selectedRegions.includes(state.code));
  // These two ride the /api/sightings request, so they drop records upstream and
  // an empty map can mean filtered out rather than not seen. Nothing else on the
  // map says they are on, so the empty state has to.
  const narrowingFilters = [
    hotspotsOnly ? "hotspots only" : null,
    includeProvisional ? null : "provisional off"
  ].filter((label): label is string => Boolean(label));
  // Insights are showing a wider area than the map plots, so a finding can name
  // a state the map would not draw. Worth saying out loud rather than letting
  // "View on map" quietly land on an empty map.
  const insightsWiderThanMap = effectiveInsightRegions.some((code) => !selectedRegions.includes(code));
  const failedRegionSummary = useMemo(() => {
    return (payload?.coverage?.failedRegions ?? [])
      .map((code) => states.find((state) => state.code === code)?.abbr ?? code)
      .join(", ");
  }, [payload?.coverage?.failedRegions, states]);
  const filteredCatalog = useMemo(() => {
    return speciesGroup === "All" ? presets : presets.filter((species) => species.group === speciesGroup);
  }, [presets, speciesGroup]);
  // What the picker lists: server-side search results while the reader is
  // typing, otherwise a capped window of the selected family. The cap keeps the
  // grid responsive against a catalog of several thousand species.
  const pickerResults = useMemo(() => {
    if (speciesQuery.trim()) {
      return suggestions.slice(0, CATALOG_PREVIEW_LIMIT);
    }
    const preview = filteredCatalog.slice(0, CATALOG_PREVIEW_LIMIT);
    if (
      selectedSpecies &&
      filteredCatalog.some((species) => species.speciesCode === selectedSpecies.speciesCode) &&
      !preview.some((species) => species.speciesCode === selectedSpecies.speciesCode)
    ) {
      return [...preview.slice(0, -1), selectedSpecies];
    }
    return preview;
  }, [filteredCatalog, selectedSpecies, speciesQuery, suggestions]);
  const featuredSpecies = useMemo(
    () =>
      featuredSpeciesCodes
        .map((code) => presets.find((species) => species.speciesCode === code))
        .filter((species): species is Species => Boolean(species)),
    [presets]
  );
  const libraryGroups = useMemo(() => {
    const present = new Set(presets.map((species) => species.group));
    const ordered = groupOrder.filter((group) => present.has(group));
    const extras = [...present].filter((group) => !groupOrder.includes(group)).sort();
    return ["All", ...ordered, ...extras];
  }, [presets]);
  const watchlistSpecies = useMemo(
    () => watchlist.map((code) => presets.find((species) => species.speciesCode === code)).filter((species): species is Species => Boolean(species)),
    [presets, watchlist]
  );
  const activeAlertFindings = useMemo(
    () => (insights?.findings ?? []).filter((finding) => finding.speciesCode && alerts.includes(finding.speciesCode)),
    [alerts, insights]
  );

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((nextConfig: ConfigResponse) => {
        setConfig(nextConfig);
        setStates(nextConfig.states);
        const browsable = browseOrder(nextConfig.presets, defaultPresets);
        setPresets(browsable);
        setSuggestions(browsable);
        setSelectedRegions((current) => {
          const validCodes = nextConfig.states.map((state) => state.code);
          return current.filter((code) => validCodes.includes(code));
        });
        // A shared ?bird= link names a species by eBird code, and only six birds
        // ship in the bootstrap list — so anything else rendered as its raw code
        // ("COMNIG") until the full catalog arrived. Upgrade to the real name.
        setSelectedSpecies((current) => {
          if (!current || current.sciName) {
            return current;
          }
          return nextConfig.presets.find((species) => species.speciesCode === current.speciesCode) ?? current;
        });
      })
      .catch(() => {
        setConfig({ hasApiKey: false, states: defaultStates, presets: defaultPresets, maxBackDays: 30 });
      });
  }, []);

  // A shared ?bird= link can name a code this build has never heard of: a typo,
  // or a real taxonomy-only species outside the local catalog. Mounting it as a
  // species regardless put the raw token in the masthead as the page headline
  // ("NOTAREALBIRD") and let the doomed sightings request report a made-up eBird
  // outage, complete with a Retry that could never succeed. Resolve it properly
  // and only then decide, so genuine rare codes still work.
  useEffect(() => {
    if (!config || !selectedSpecies || selectedSpecies.sciName) {
      return;
    }
    const code = selectedSpecies.speciesCode;
    if (resolvedCodesRef.current.has(code)) {
      return;
    }
    resolvedCodesRef.current.add(code);

    let cancelled = false;
    fetch(`/api/species?q=${encodeURIComponent(code)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("lookup failed"))))
      .then((data: { items?: Species[] }) => {
        if (cancelled) {
          return;
        }
        const match = (Array.isArray(data?.items) ? data.items : []).find(
          (species) => species.speciesCode.toLowerCase() === code.toLowerCase()
        );
        if (match) {
          setSelectedSpecies(match);
          return;
        }
        setUnknownCode(code);
        setSelectedSpecies(null);
        setPayload(null);
      })
      // A failed lookup is not proof the code is bad. Leave the species alone
      // and let the normal sightings error path speak for itself.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [config, selectedSpecies]);

  // Which surfaces on screen actually need findings. Insights obviously, but
  // also My birds: field alerts are read off the same notable findings, so a
  // reader who armed an alert and never opened Insights would otherwise never
  // get one. Both triggers are a drawer the reader opened themselves, so
  // browsing the map alone still pays nothing.
  const insightsWanted =
    drawer === "insights"
    || Boolean(insights)
    || (drawer === "birds" && alerts.length > 0);

  // Keep insights in step with whatever scope they're pinned to, debounced so
  // dragging the window presets doesn't fire a request per step.
  //
  // Insights fan out to eBird across every selected state and then to an LLM,
  // so this only runs when something on screen is waiting on them.
  useEffect(() => {
    if (
      !insightsWanted
      || !effectiveInsightRegions.length
      || (insights?.back === effectiveInsightBack && sameCodeSet(insights.regions, effectiveInsightRegions))
      || insightsLoading
      // This exact scope already failed; wait for an explicit Re-run.
      || failedInsightScopeRef.current === insightScopeKey
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void loadInsights(), 700);
    return () => window.clearTimeout(timeout);
  }, [
    effectiveInsightBack,
    effectiveInsightRegions,
    insightScopeKey,
    insights,
    insightsLoading,
    insightsWanted,
    loadInsights
  ]);

  // Refresh the starter questions each time Ask opens, biased toward the
  // region in view so the suggestions are actually answerable.
  useEffect(() => {
    if (drawer !== "ask") {
      return;
    }
    const regional = selectedRegionPreset ? REGIONAL_CHAT_PROMPTS[selectedRegionPreset.id] ?? [] : [];
    const pool = regional.length
      ? [...samplePrompts(regional, 2), ...samplePrompts(CHAT_PROMPTS, 2)]
      : samplePrompts(CHAT_PROMPTS, 4);
    setChatSuggestions(samplePrompts(pool, 4));
  }, [drawer, selectedRegionPreset]);

  useEffect(() => {
    writeStoredJson(PREFERENCES_KEY, {
      lookbackDays,
      regions: selectedRegions,
      timelineMode,
      includeProvisional,
      hotspotsOnly
    });
  }, [hotspotsOnly, includeProvisional, lookbackDays, selectedRegions, timelineMode]);

  useEffect(() => writeStoredJson(WATCHLIST_KEY, watchlist), [watchlist]);
  useEffect(() => writeStoredJson(ALERTS_KEY, alerts), [alerts]);

  useEffect(() => {
    if (!speciesQuery.trim()) {
      setSuggestions(presets);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchFailed(false);
      fetch(`/api/species?q=${encodeURIComponent(speciesQuery)}`, { signal: controller.signal })
        .then((response) => {
          // An error body has no items. Parsing it anyway and handing the
          // undefined straight to state crashed the render to a blank page.
          if (!response.ok) {
            throw new Error(String(response.status));
          }
          return response.json();
        })
        // An empty result must stay empty. Falling back to the full catalog
        // made a search that matched nothing render 48 unrelated birds, and
        // made Enter commit whichever one happened to sort first.
        .then((data: { items?: Species[]; total?: number }) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          setSuggestions(items);
          setSearchTotal(typeof data?.total === "number" ? data.total : items.length);
        })
        .catch((error: unknown) => {
          // An aborted request is the next keystroke arriving, not a failure.
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          // Reporting a dead search as "No birds match that search" told the
          // reader their bird does not exist. Say the search broke instead.
          setSearchFailed(true);
          setSuggestions([]);
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [presets, speciesQuery]);

  const loadSightings = useCallback(async (options?: { force?: boolean }) => {
    // No species chosen is the "browse all birds" state: clear the map and skip
    // the API. Selecting a species (or clearing again) re-runs this effect.
    if (!selectedSpecies) {
      sightingsRequestRef.current?.abort();
      setPayload(null);
      setError("");
      setLoading(false);
      return;
    }
    if (!selectedRegions.length) {
      sightingsRequestRef.current?.abort();
      setPayload(null);
      setError("Select at least one state.");
      return;
    }

    const params = new URLSearchParams({
      species: selectedSpecies.speciesCode,
      back: String(lookbackDays),
      includeProvisional: String(includeProvisional),
      hotspot: String(hotspotsOnly),
      regions: selectedRegions.join(",")
    });
    // Force = bypass the 5-minute server cache and any CDN copy (unique URL).
    if (options?.force) {
      params.set("fresh", "1");
      params.set("_t", String(Date.now()));
    }

    sightingsRequestRef.current?.abort();
    const controller = new AbortController();
    sightingsRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/sightings?${params.toString()}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Sightings request failed.");
      }
      setPayload(data);
      setSelectedDayIndex(lookbackDays - 1);
      setPlaying(false);
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "Sightings request failed.");
    } finally {
      if (sightingsRequestRef.current === controller) {
        sightingsRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [hotspotsOnly, includeProvisional, lookbackDays, selectedRegions, selectedSpecies?.speciesCode]);

  useEffect(() => {
    const timeout = window.setTimeout(loadSightings, 360);
    return () => window.clearTimeout(timeout);
  }, [loadSightings]);

  useEffect(() => () => sightingsRequestRef.current?.abort(), []);

  useEffect(() => {
    setSelectedDayIndex((current) => Math.min(current, lookbackDays - 1));
  }, [lookbackDays]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const interval = window.setInterval(() => {
      setSelectedDayIndex((current) => {
        if (current >= lookbackDays - 1) {
          window.clearInterval(interval);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 850);
    return () => window.clearInterval(interval);
  }, [lookbackDays, playing]);

  useEffect(() => {
    const container = mapElementRef.current;
    if (!container || mapRef.current) {
      return;
    }

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    }).setView([39.5, -98.35], 4);

    // Positron split into base + labels so the place names can sit at reduced
    // opacity: quiet enough not to compete with the masthead, present enough
    // that a cluster of dots is identifiable without clicking one. Both layers
    // live in the tile pane, so the paper tint in CSS applies to each.
    const baseLayer = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      {
        className: "map-base",
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap &copy; CARTO"
      }
    ).addTo(map);
    // Separate class so the two layers can be filtered independently: the paper
    // tint that suits the base terrain would wash the labels out entirely.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
      className: "map-labels",
      maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    mapRef.current = map;
    baseLayerRef.current = baseLayer;
    sightingLayerRef.current = L.layerGroup().addTo(map);
    // Dev-only escape hatch so browser-based tests can read the real map state
    // (getZoom/getCenter); inert in production builds.
    if (import.meta.env.DEV) {
      (window as unknown as { __flocklineMap?: L.Map }).__flocklineMap = map;
    }

    // Keep Leaflet's cached size honest. This covers the drawer docking, window
    // resizes, and the first-paint case where the container is not measurable
    // yet — replaying whichever fit was deferred as soon as there is a real box.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      const pending = pendingFitRef.current;
      if (pending && size.x && size.y) {
        pendingFitRef.current = null;
        pending(map);
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.clearTimeout(fitRetryRef.current);
      pendingFitRef.current = null;
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      sightingLayerRef.current = null;
    };
  }, []);

  // With no sightings loaded, frame the states the reader has selected.
  useEffect(() => {
    if (payload && allFeatures.length) {
      return;
    }
    const selected = states.filter((state) => selectedRegions.includes(state.code));
    // Alaska and Hawaii sit 50+ degrees of longitude off the mainland, so
    // including them in the frame drags the whole view out to a hemisphere:
    // "Nationwide" opened on Greenland and Japan with the US too small to read.
    // Frame the contiguous states unless the selection is only offshore ones.
    const contiguous = selected.filter((state) => !OFFSHORE_STATES.has(state.code));
    const centers = (contiguous.length ? contiguous : selected).map((state) => state.center);
    runFit((map) => {
      if (!centers.length) {
        map.setView([39.5, -98.35], 4, { animate: false });
      } else if (centers.length === 1) {
        map.setView(centers[0], 6, { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(centers), { maxZoom: 6, animate: false, ...fitPadding() });
      }
    });
  }, [allFeatures.length, payload, runFit, selectedRegions, states]);

  useEffect(() => {
    const layer = sightingLayerRef.current;
    if (!layer) {
      return;
    }

    layer.clearLayers();
    for (const feature of visibleFeatures) {
      const [lng, lat] = feature.geometry.coordinates;
      const color = getFeatureColor(feature, dateKeys);
      const count = feature.properties.howMany ?? 1;
      // Kept small and lightly ringed: at a few thousand locations, fatter dots
      // merge into a blob. The paper-colored ring separates neighbours without
      // reading as a second color.
      const marker = L.circleMarker([lat, lng], {
        radius: Math.min(9, 3.2 + Math.sqrt(count) * 1.4),
        color: "#f4f2ed",
        fillColor: color,
        fillOpacity: feature.properties.obsReviewed ? 0.92 : 0.58,
        opacity: 0.9,
        weight: feature.properties.locationPrivate ? 0.75 : 1.1
      });
      // No aria here: under preferCanvas the marker has no element of its own
      // (getElement() returns null), so keyboard and screen-reader access to a
      // sighting lives in the .sighting-index list, which calls this same
      // handler.
      marker.on("click", () => selectSighting(feature));
      marker.addTo(layer);
    }

    const pulseFeatures = visibleFeatures
      .filter((feature) => feature.properties.obsDt.slice(0, 10) === selectedDateKey)
      .slice(0, playing ? 28 : 16);
    for (const feature of pulseFeatures) {
      const [lng, lat] = feature.geometry.coordinates;
      L.marker([lat, lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: `flock-pulse-icon ${playing ? "playing" : ""}`,
          html: '<span class="flock-pulse-ring"></span><span class="flock-pulse-core"></span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(layer);
    }
  }, [dateKeys, playing, selectSighting, selectedDateKey, visibleFeatures]);

  useEffect(() => {
    if (!payload || !mapRef.current) {
      return;
    }
    if (!allFeatures.length) {
      // Nothing to show for this load: drop any pending focus so it can't fire
      // later against an unrelated species' payload — but only once the payload
      // reflects the states we are actually asking for. Viewing an out-of-region
      // finding produces an empty intermediate load (the bird is not in the old
      // states yet), and dropping the focus there lost the zoom to the bird.
      if (sameCodeSet(payload.regions, selectedRegions)) {
        pendingFocusRef.current = null;
      }
      return;
    }
    const fitKey = `${payload.generatedAt}-${payload.species.speciesCode}-${payload.regions.join("|")}`;

    // An explicit focus request (chat show_on_map or an insight's View on map)
    // always wins — checked BEFORE the fitKey dedupe, because the 5-minute
    // sightings cache reuses generatedAt: a repeat load of the same species
    // produces an identical fitKey, which would otherwise swallow the zoom.
    // Instant (no animation) so it lands reliably even when rAF-driven
    // animation is throttled (background tabs).
    const focus = pendingFocusRef.current;
    if (focus) {
      // Hold the focus until the payload actually reflects the states we are
      // asking for. Viewing an out-of-region finding widens the map, which
      // fires a second load; consuming the focus on the first one let that
      // second load's broad fit pull the view back out to the whole country
      // instead of leaving it on the bird.
      const settled = sameCodeSet(payload.regions, selectedRegions);
      if (settled) {
        pendingFocusRef.current = null;
        lastFitKeyRef.current = fitKey;
        runFit((map) => map.setView([focus.lat, focus.lng], 11, { animate: false }));
      }
      return;
    }

    if (lastFitKeyRef.current === fitKey) {
      return;
    }
    lastFitKeyRef.current = fitKey;

    const bounds = L.latLngBounds(
      allFeatures.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number])
    );
    // Never animate a programmatic fit. The global reduced-motion rule zeroes
    // transition durations and background tabs throttle rAF, either of which
    // leaves Leaflet's animated zoom waiting on a frame that never arrives —
    // the move then silently no-ops and the map stays where it was.
    runFit((map) =>
      map.fitBounds(bounds, { maxZoom: 8, animate: false, ...fitPadding() })
    );
  }, [allFeatures, payload, runFit, selectedRegions]);

  const selectSpecies = (species: Species) => {
    setSelectedSighting(null);
    setUnknownCode(null);
    // Drop the outgoing bird's dots immediately. Without this the map showed the
    // previous species' distribution and counts under the new species' name for
    // the length of the request.
    if (species.speciesCode !== selectedSpecies?.speciesCode) {
      setPayload(null);
    }
    setSelectedSpecies(species);
    // Deliberately does not write speciesQuery. Nothing renders it outside the
    // picker (which clears it on open), and setting it fired a debounced
    // /api/species lookup whose result was thrown away on every selection.
  };

  // Clearing returns to the "all birds" browse state: no species on the map,
  // search emptied. The map, metric rail, and timeline each show empty states.
  const clearSpecies = () => {
    setSelectedSighting(null);
    setSelectedSpecies(null);
    setSpeciesQuery("");
    setPayload(null);
    setPlaying(false);
    setError("");
    // Reset fit tracking: re-selecting the same species after a clear returns a
    // cached payload (same generatedAt), which would otherwise skip the re-fit.
    lastFitKeyRef.current = "";
    pendingFocusRef.current = null;
  };

  // Insights and the chat both surface birds that can sit outside the map's
  // states. Loading one into a region it does not occur in leaves the map empty
  // with no explanation, so widen the selection to the bird's state first.
  // Returns true when the selection actually changed, which means a reload is
  // coming and the caller must leave the camera to pendingFocusRef.
  const widenRegionsFor = useCallback(
    (regionCode?: string | null) => {
      if (!regionCode) {
        return false;
      }
      // Held in a const so the narrowed type survives into the callbacks below.
      const code = regionCode;
      if (selectedRegions.includes(code) || !states.some((state) => state.code === code)) {
        return false;
      }
      setSelectedRegions((current) => (current.includes(code) ? current : [...current, code]));
      // Keep the menu's state grid on a region that actually contains it.
      const home = US_REGION_PRESETS.find(
        (preset) => preset.id !== "nationwide" && preset.stateCodes.includes(code)
      );
      if (home && !getRegionPreset(focusedRegionId)?.stateCodes.includes(code)) {
        setFocusedRegionId(home.id);
      }
      return true;
    },
    [focusedRegionId, selectedRegions, states]
  );

  // Load an insight's species and fly to the exact spot it names, rather than
  // doing a broad fit that's easy to miss behind the docked drawer.
  const showFindingOnMap = (finding: Insight) => {
    if (!finding.speciesCode) {
      return;
    }
    // Insights can be scoped wider than the map: viewing a Nationwide finding
    // from Oklahoma while the map covers only the Northeast used to load the
    // species into a region it does not occur in.
    const widened = widenRegionsFor(finding.regionCode);
    const hasFocus = typeof finding.lat === "number" && typeof finding.lng === "number";
    const sameSpecies = selectedSpecies?.speciesCode === finding.speciesCode;
    if (hasFocus) {
      pendingFocusRef.current = { lat: finding.lat as number, lng: finding.lng as number };
    }
    selectSpecies({
      speciesCode: finding.speciesCode,
      comName: finding.comName || finding.speciesCode,
      sciName: "",
      group: "Species"
    });
    // Already the active species: no reload fires the fit effect, so move now.
    // Instant, per the Leaflet animate gotcha above. Skipped when we just
    // widened, because that does force a reload whose fit would undo the move.
    if (sameSpecies && !widened && hasFocus && mapRef.current) {
      pendingFocusRef.current = null;
      mapRef.current.setView([finding.lat as number, finding.lng as number], 11, { animate: false });
    }
    if (!isWide) {
      setDrawer(null);
    }
  };

  const toggleWatched = (speciesCode: string) => {
    setWatchlist((current) => {
      if (current.includes(speciesCode)) {
        setAlerts((active) => active.filter((code) => code !== speciesCode));
        return current.filter((code) => code !== speciesCode);
      }
      return [...current, speciesCode];
    });
  };

  const toggleAlert = (speciesCode: string) => {
    setAlerts((current) =>
      current.includes(speciesCode)
        ? current.filter((code) => code !== speciesCode)
        : [...current, speciesCode]
    );
  };

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || chatLoading) {
        return;
      }
      const history = [...chatMessages, { role: "user", content: trimmed } as ChatMessage];
      setChatMessages(history);
      setChatInput("");
      setChatError("");
      // Keep the text so a failure can restore it; retyping after a rate limit
      // just burns another request.
      setChatLoading(true);
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((message) => ({ role: message.role, content: message.content })),
            regions: selectedRegions
          })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Chat request failed.");
        }
        setChatMessages((current) => [
          ...current,
          { role: "assistant", content: data.reply, speciesRefs: data.speciesRefs ?? [] }
        ]);
        if (data.mapAction) {
          setPendingMapAction(data.mapAction);
        }
      } catch (requestError) {
        setChatInput(trimmed);
        setChatError(requestError instanceof Error ? requestError.message : "Chat request failed.");
      } finally {
        setChatLoading(false);
      }
    },
    [chatMessages, chatLoading, selectedRegions]
  );

  const viewSpeciesFromChat = (ref: ChatSpeciesRef) => {
    // The assistant answers nationwide, so a bird it named can sit outside the
    // map's states. Widen first, exactly as an insight's View on map does.
    widenRegionsFor(ref.regionCode);
    selectSpecies({ speciesCode: ref.speciesCode, comName: ref.comName, sciName: "", group: "Species" });
    // When docked the panel sits beside the map, so keep it open; when it
    // overlays (narrow screens), close it so the map is visible.
    if (!isWide) {
      setDrawer(null);
    }
  };

  // Keep the transcript pinned to the latest message as it grows.
  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [chatMessages, chatLoading, drawer]);

  // Both async panels announce through one short status line rather than making
  // their results live: aria-live on the transcript would re-read the whole
  // thread every turn, and on the insights list it would re-read every card each
  // time the scope changes.
  const chatAnnouncement = useMemo(() => {
    if (chatError) {
      return chatError;
    }
    if (chatLoading) {
      return "Checking eBird";
    }
    const latest = chatMessages[chatMessages.length - 1];
    return latest?.role === "assistant" ? latest.content : "";
  }, [chatError, chatLoading, chatMessages]);

  const insightsAnnouncement = useMemo(() => {
    if (insightsLoading) {
      return "Reading recent checklists";
    }
    if (insightsError) {
      return insightsError;
    }
    if (!insights) {
      return "";
    }
    return insights.findings.length
      ? `${insights.findings.length} ${insights.findings.length === 1 ? "finding" : "findings"} in ${insightsScopeLabel}.`
      : `No notable sightings in ${insightsScopeLabel}.`;
  }, [insights, insightsError, insightsLoading, insightsScopeLabel]);

  // Apply a map action the chat requested: load the species and, if it named a
  // spot, zoom there (pendingFocusRef is consumed by the fit effect on reload).
  useEffect(() => {
    if (!pendingMapAction) {
      return;
    }
    const action = pendingMapAction;
    setPendingMapAction(null);
    // The assistant works nationwide while the map may be pinned to a few
    // states, so widen to the spot's state before the species loads.
    const widened = widenRegionsFor(action.regionCode);
    const hasFocus = action.lat != null && action.lng != null;
    const sameSpecies = selectedSpecies?.speciesCode === action.speciesCode;
    if (hasFocus) {
      pendingFocusRef.current = { lat: action.lat as number, lng: action.lng as number };
    }
    selectSpecies({
      speciesCode: action.speciesCode,
      comName: action.comName || action.speciesCode,
      sciName: "",
      group: "Species"
    });
    // If it's already the active species, no reload fires the focus move, so do
    // it now. Widening does force a reload, so in that case leave the camera to
    // the fit effect, which holds the focus until the payload matches the new
    // states.
    if (sameSpecies && !widened && hasFocus && mapRef.current) {
      pendingFocusRef.current = null;
      mapRef.current.setView([action.lat as number, action.lng as number], 11, { animate: false });
    }
    // On narrow screens the chat covers the map, so close it to reveal the result.
    if (!isWide) {
      setDrawer(null);
    }
  }, [pendingMapAction, selectedSpecies?.speciesCode, isWide, widenRegionsFor]);

  // Track whether we're wide enough to dock the drawers (vs. overlay).
  useEffect(() => {
    const query = window.matchMedia("(min-width: 861px)");
    const handler = (event: MediaQueryListEvent) => setIsWide(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  // Docking resizes the map container; the ResizeObserver set up with the map
  // re-measures Leaflet throughout the slide, so nothing extra is needed here.
  const docked = drawer !== null && isWide;

  // Keep the selected bird visible in the browse grid (whether it was picked
  // from search, chat, or insights) so it's always clear which one is active.
  // We scroll only within the grid's own scroll area, never the whole panel.
  useEffect(() => {
    const grid = speciesGridRef.current;
    if (!grid || !selectedSpecies) {
      return;
    }
    const active = grid.querySelector<HTMLButtonElement>("button.active");
    if (!active) {
      return;
    }
    const gridRect = grid.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < gridRect.top || activeRect.bottom > gridRect.bottom) {
      grid.scrollTop += activeRect.top - gridRect.top - (grid.clientHeight - active.clientHeight) / 2;
    }
  }, [selectedSpecies, filteredCatalog]);

  // The timeline step points at the scrubber when there is one, and otherwise
  // describes what will appear. Tour drops steps whose target is hidden, so a
  // fixed selector meant a first-time visitor never heard about the timeline.
  const tourSteps = useMemo(() => {
    const timelineStep: TourStep = selectedSpecies
      ? {
          target: ".scrubber",
          side: "top",
          title: "Scrub through the days",
          body: "Drag the rail or press play to watch movement unfold. Bars count locations by their latest report date, and dot color runs blue for older to red for freshest."
        }
      : {
          side: "center",
          title: "Then watch it move",
          body: "Once a bird is loaded, a timeline appears along the bottom. Drag it or press play to watch reports accumulate day by day, blue for older through red for freshest."
        };
    return [...TOUR_STEPS.slice(0, 3), timelineStep, ...TOUR_STEPS.slice(3)];
  }, [selectedSpecies]);

  // Close the menu first: below 860px the drawer is the only route to the tour,
  // and every step targeting the scrubber or tabs would spotlight a blank patch
  // of the drawer sheet.
  const openTour = () => {
    setDrawer(null);
    setTourOpen(true);
  };

  // First visit opens the tour on its own, once the map has painted so the
  // spotlight measures against the real layout rather than an empty shell.
  useEffect(() => {
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(TOUR_SEEN_KEY));
    } catch {
      // Storage blocked: skip the tour rather than showing it on every load.
    }
    if (seen) {
      return;
    }
    // Someone who starts using the app inside the first 900ms should not have
    // it taken away from them. The tour used to open over whatever they had
    // begun, steal focus, and swallow the keystrokes they were typing. Cancel
    // on the first real interaction, and leave the seen flag unwritten so the
    // tour is still offered next visit.
    const timeout = window.setTimeout(() => {
      // openTour, not setTourOpen: the manual path closes any open drawer
      // first, otherwise every step spotlights a blank patch of drawer sheet.
      openTour();
    }, 900);
    const cancel = () => window.clearTimeout(timeout);
    window.addEventListener("pointerdown", cancel, { once: true });
    window.addEventListener("keydown", cancel, { once: true });
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeTour = () => {
    setTourOpen(false);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      // Ignore storage failures; worst case the tour shows again next visit.
    }
  };

  // Returns whether it committed, so the caller only closes the picker when a
  // bird was actually chosen.
  const commitSearch = () => {
    if (!speciesQuery.trim()) {
      return false;
    }
    const exact =
      suggestions.find((species) => normalizeSpecies(species.comName) === normalizeSpecies(speciesQuery)) ||
      suggestions.find((species) => normalizeSpecies(species.speciesCode) === normalizeSpecies(speciesQuery));
    // Commit only when the answer is unambiguous. eBird splits some birds into
    // groups, so "yellow warbler" has no exact match and five equally good
    // ones; taking the first alphabetically committed Mangrove Yellow Warbler
    // to someone who meant the ordinary one. On a tie the caller focuses the
    // result list instead, so the reader picks.
    const match = exact || (suggestions.length === 1 ? suggestions[0] : null);
    if (match) {
      selectSpecies(match);
      return true;
    }
    // Deliberately no raw-code escape hatch. Accepting any bare token as a
    // species code turned a typo ("ospry") into a 502 that the UI reported as
    // an eBird outage, with a Retry that could never succeed. A miss now leaves
    // the picker open on "No birds match that search."
    return false;
  };

  const toggleRegion = (regionCode: string) => {
    setSelectedRegions((current) => {
      if (current.includes(regionCode)) {
        return current.filter((code) => code !== regionCode);
      }
      return [...current, regionCode];
    });
  };

  const selectRegionPreset = (regionId: string) => {
    const region = getRegionPreset(regionId);
    if (!region) return;
    const available = new Set(states.map((state) => state.code));
    setFocusedRegionId(region.id);
    setSelectedRegions(region.stateCodes.filter((code) => available.has(code)));
  };
  const selectAllRegions = () => setSelectedRegions(visibleRegionStates.map((state) => state.code));
  const clearRegions = () => setSelectedRegions([]);
  const allRegionsSelected = visibleRegionStates.length > 0
    && visibleRegionStates.every((state) => selectedRegions.includes(state.code));

  const startPlayback = () => {
    if (selectedDayIndex >= lookbackDays - 1) {
      setSelectedDayIndex(0);
    }
    setPlaying(true);
  };

  const baseAppState = useMemo(
    (): AppState => ({
      speciesCode: selectedSpecies?.speciesCode ?? null,
      lookbackDays,
      regions: selectedRegions,
      timelineMode,
      includeProvisional,
      hotspotsOnly
    }),
    [hotspotsOnly, includeProvisional, lookbackDays, selectedRegions, selectedSpecies?.speciesCode, timelineMode]
  );
  const allRegionCodes = useMemo(() => states.map((state) => state.code), [states]);

  // The URL in the address bar tracks the map, plus the open drawer and any
  // pinned insights scope, so a copy-paste of the bar reproduces the screen.
  const currentAppUrl = useMemo(
    () =>
      buildAppUrl(
        window.location.href,
        {
          ...baseAppState,
          view: drawer && drawer !== "menu" ? drawer : "map",
          insightRegions,
          insightBack
        },
        allRegionCodes,
        US_REGION_PRESETS
      ),
    [allRegionCodes, baseAppState, drawer, insightBack, insightRegions]
  );

  // What the share button copies. Explicit on every field, unlike the address
  // bar: a link that omits a default gets filled in from the RECIPIENT's saved
  // preferences, so the view they open is not the view that was shared.
  const shareableUrl = useMemo(
    () =>
      buildAppUrl(
        window.location.href,
        {
          ...baseAppState,
          view: drawer && drawer !== "menu" ? drawer : "map",
          insightRegions,
          insightBack
        },
        allRegionCodes,
        US_REGION_PRESETS,
        { explicit: true }
      ),
    [allRegionCodes, baseAppState, drawer, insightBack, insightRegions]
  );

  // A link that always lands on Insights at the scope currently on screen,
  // whether or not the reader pinned it. This is the one people share.
  const insightsShareUrl = useMemo(
    () =>
      buildAppUrl(
        window.location.href,
        {
          ...baseAppState,
          view: "insights",
          insightRegions: effectiveInsightRegions,
          insightBack: effectiveInsightBack
        },
        allRegionCodes,
        US_REGION_PRESETS,
        { explicit: true }
      ),
    [allRegionCodes, baseAppState, effectiveInsightBack, effectiveInsightRegions]
  );

  // Back used to leave the site: every state change replaced the URL, so the
  // app never put an entry in history and the browser's Back went to whatever
  // page came before Flockline. Give the coarse, deliberate transitions their
  // own entry (choosing a bird, opening or closing a panel) and keep replacing
  // for the continuous ones, or Back would have to walk back through every
  // intermediate value of the day rail.
  const historyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${baseAppState.speciesCode ?? "browse"}|${drawer && drawer !== "menu" ? drawer : "map"}`;
    const first = historyKeyRef.current === null;
    const coarseChange = !first && historyKeyRef.current !== key;
    historyKeyRef.current = key;
    if (coarseChange) {
      window.history.pushState(null, "", currentAppUrl);
    } else {
      window.history.replaceState(null, "", currentAppUrl);
    }
  }, [baseAppState.speciesCode, currentAppUrl, drawer]);

  // Every URL shared the same tab title, so several Flockline tabs were
  // indistinguishable and a bookmark said nothing about what it pointed at.
  // The og tags still need prerendering; this is the part that is a few lines.
  useEffect(() => {
    const bird = selectedSpecies?.comName;
    const scope = selectedRegionSummary;
    document.title = bird
      ? `${bird} · past ${lookbackDays === 1 ? "day" : `${lookbackDays} days`} · ${scope} · Flockline`
      : "Flockline · Live U.S. Bird Sightings";
  }, [lookbackDays, selectedRegionSummary, selectedSpecies]);

  // Rehydrate from the URL when the reader goes Back or Forward. Without this
  // the address bar would move but the screen would not follow it.
  useEffect(() => {
    const onPopState = () => {
      const next = parseAppState(window.location.search, allRegionCodes, US_REGION_PRESETS);

      const nextCode = next.speciesCode;
      if (nextCode === null || typeof nextCode === "string") {
        setSelectedSpecies((current) => {
          if (nextCode === null) {
            return null;
          }
          if (current?.speciesCode === nextCode) {
            return current;
          }
          return (
            presets.find((species) => species.speciesCode === nextCode)
            ?? { speciesCode: nextCode, comName: nextCode, sciName: "", group: "Species" }
          );
        });
      }
      if (next.regions?.length) {
        setSelectedRegions(next.regions);
      }
      if (typeof next.lookbackDays === "number") {
        setLookbackDays(next.lookbackDays);
      }
      if (next.timelineMode) {
        setTimelineMode(next.timelineMode);
      }
      if (typeof next.includeProvisional === "boolean") {
        setIncludeProvisional(next.includeProvisional);
      }
      if (typeof next.hotspotsOnly === "boolean") {
        setHotspotsOnly(next.hotspotsOnly);
      }
      if (next.insightRegions !== undefined) {
        setInsightRegions(next.insightRegions);
      }
      if (next.insightBack !== undefined) {
        setInsightBack(next.insightBack);
      }
      const view = next.view ?? "map";
      setDrawer(view === "map" ? null : view);
      // Keep the key in step, otherwise the sync effect reads this as a fresh
      // coarse change and pushes a duplicate entry on top of the one we just
      // navigated to.
      historyKeyRef.current = `${next.speciesCode ?? "browse"}|${view}`;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [allRegionCodes, presets]);

  const shareView = async () => {
    try {
      await navigator.clipboard.writeText(shareableUrl);
      setShareStatus("Link copied");
    } catch {
      setShareStatus("Copy failed");
    }
    window.setTimeout(() => setShareStatus(""), 1800);
  };

  const copyInsightsLink = async () => {
    try {
      await navigator.clipboard.writeText(insightsShareUrl);
      setInsightLinkStatus("Link copied");
    } catch {
      setInsightLinkStatus("Copy failed");
    }
    window.setTimeout(() => setInsightLinkStatus(""), 1800);
  };

  const shareSighting = async (feature: SightingFeature) => {
    const destination = feature.properties.subId
      ? `https://ebird.org/checklist/${feature.properties.subId}`
      : currentAppUrl;
    try {
      await navigator.clipboard.writeText(destination);
      setSightingShareStatus("Copied");
    } catch {
      setSightingShareStatus("Copy failed");
    }
    window.setTimeout(() => setSightingShareStatus(""), 1800);
  };

  const hasApiKey = config?.hasApiKey ?? false;
  // In the browse state there's no payload, so reflect the configured source (a
  // live key is live, just idle) instead of mislabeling it "Demo stream".
  const isLiveSource = payload ? payload.source === "ebird" : hasApiKey;
  // Blank until config lands: defaulting hasApiKey to false made the line read
  // "Demo stream" for the first moment of every visit.
  const sourceLabel = config === null ? "" : isLiveSource ? "Live eBird" : "Demo stream";

  return (
    <main className={`app ${docked ? "docked" : ""}`}>
      <a className="skip-link" href="#drawer-panel" onClick={() => openDrawer("menu")}>
        Skip to controls
      </a>

      <div className="app-body">
        <header className="topbar">
          <div className="chrome-top">
            <div className="chrome-top-left">
              <div className="segmented window-pills on-paper" role="group" aria-label="Lookback window">
                {WINDOW_PRESETS.map((days) => (
                  <button
                    type="button"
                    key={days}
                    className={lookbackDays === days ? "active" : ""}
                    aria-pressed={lookbackDays === days}
                    onClick={() => setLookbackDays(days)}
                    title={`Past ${days} ${days === 1 ? "day" : "days"}`}
                  >
                    {days}D
                  </button>
                ))}
                {/* A shared ?days=10 link or a preference saved by the old
                    1-30 slider is still honoured, so show it rather than leaving
                    every pill dark while the map plots a window nothing reflects. */}
                {WINDOW_PRESETS.includes(lookbackDays) ? null : (
                  <button
                    type="button"
                    className="active"
                    aria-pressed="true"
                    title={`Past ${lookbackDays} days (from a shared link)`}
                  >
                    {lookbackDays}D
                  </button>
                )}
              </div>
            </div>

            <div className="masthead">
              {/* The wordmark doubles as the home control. Clicking a logo to
                  get back to a clean slate is the one navigation convention
                  everyone already knows, so it should not be the one thing on
                  the page that does nothing. */}
              <button
                type="button"
                className="masthead-eyebrow"
                onClick={startOver}
                title="Back to the start: all states, no bird"
              >
                flockline
              </button>
              <button
                type="button"
                className="masthead-title"
                ref={mastheadRef}
                onClick={openPicker}
                title="Change species"
                aria-haspopup="dialog"
              >
                {selectedSpecies ? selectedSpecies.comName : "Choose a bird"}
                <ChevronDown className="caret" aria-hidden="true" />
              </button>
              <p className="masthead-meta">
                {selectedSpecies ? (
                  <>
                    <span>
                      {loading ? "Counting" : `${windowStats.locations.toLocaleString()} locations`}
                    </span>
                    <span className="sep">·</span>
                    {/* Locations and birds diverge sharply for flocking species,
                        so showing only locations made a report of 4,000 look
                        identical to a report of one. */}
                    {!loading && windowStats.birds > windowStats.locations ? (
                      <>
                        <span title="Sum of the counts birders entered, where they gave a number">
                          {windowStats.birds.toLocaleString()} birds
                        </span>
                        <span className="sep">·</span>
                      </>
                    ) : null}
                  </>
                ) : null}
                <span>{selectedRegionSummary}</span>
                <span className="sep">·</span>
                <span>{sourceLabel}</span>
              </p>
              {selectedSpecies && underreportedCommon.has(selectedSpecies.speciesCode) ? (
                <p className="masthead-note">
                  {selectedSpecies.comName} is heavily under-reported on eBird. Birders skip logging
                  common species, so this map shows far fewer spots than where they really are.
                </p>
              ) : null}
            </div>

            <div className="chrome-top-right">
            {/* Reset to the opening position: nationwide, no bird, default
                window. Shown only when there is actually something to reset. */}
            {selectedSpecies || selectedRegionPreset?.id !== "nationwide" ? (
              <button
                type="button"
                className="pill icon-only tip start-over-pill"
                data-tip="Start over"
                onClick={startOver}
                aria-label="Start over: clear the bird and show all states"
              >
                <RotateCcw />
              </button>
            ) : null}
              {/* The only other way to star a bird is the sighting sheet, which
                  needs a plotted dot to click — so a species with no reports in
                  the window could not be watched at all. */}
              {selectedSpecies ? (
                <button
                  type="button"
                  className={`pill icon-only tip watch-pill ${watchlist.includes(selectedSpecies.speciesCode) ? "active" : ""}`}
                data-tip={watchlist.includes(selectedSpecies.speciesCode) ? "In My birds" : "Save to My birds"}
                  onClick={() => toggleWatched(selectedSpecies.speciesCode)}
                  aria-pressed={watchlist.includes(selectedSpecies.speciesCode)}
                  aria-label={
                    watchlist.includes(selectedSpecies.speciesCode)
                      ? `Remove ${selectedSpecies.comName} from My birds`
                      : `Add ${selectedSpecies.comName} to My birds`
                  }
                >
                  <Star />
                </button>
              ) : null}
              <button
                type="button"
                className="pill icon-only tip tour-pill"
              data-tip="Take the tour"
                onClick={openTour}
                  aria-label="Take the tour"
              >
                <Compass />
              </button>
              <button
                type="button"
                className="pill icon-only tip share-pill"
                /* Driven from status like aria-label already is. The icon
                   switched to a tick while the tooltip underneath still read
                   "Copy link", so the two contradicted each other. */
                data-tip={shareStatus || "Copy link to this view"}
                onClick={() => void shareView()}
                  aria-label={shareStatus || "Copy a link to this view"}
              >
                {shareStatus === "Link copied" ? <Check /> : <Share2 />}
              </button>
              <button
                type="button"
                className="pill icon-only tip refresh-pill"
              data-tip="Refresh from eBird"
                onClick={() => loadSightings({ force: true })}
                disabled={loading || !selectedSpecies}
                  aria-label="Refresh from eBird"
              >
                <RefreshCw className={loading ? "spin" : ""} />
              </button>
              <button
                type="button"
                className={`pill lower tip menu-pill ${drawer === "menu" ? "active" : ""}`}
              data-tip="States and filters"
                onClick={() => openDrawer("menu")}
                aria-expanded={drawer === "menu"}
              >
                menu
              </button>
            </div>
          </div>
        </header>

        <div className="stage">
        <div className="map-layer">
          <div ref={mapElementRef} className="map-canvas" />
        </div>

        {/* Keyboard and screen-reader path to the dots. The canvas renderer
            gives the markers no DOM of their own, so this list mirrors what is
            plotted and shares the marker's selection handler. It stays clipped
            until it holds focus, like the skip link, so focus is never
            invisible. */}
        {accessibleSightings.length ? (
          <div className="sighting-index">
            <h2 id="sighting-index-label">Plotted sightings</h2>
            <p>
              {visibleFeatures.length.toLocaleString()}{" "}
              {visibleFeatures.length === 1 ? "location" : "locations"} on the map
              {visibleFeatures.length > accessibleSightings.length
                ? `, listing the ${accessibleSightings.length} most recent`
                : ""}
              .
            </p>
            <ul aria-labelledby="sighting-index-label">
              {accessibleSightings.map((feature, index) => (
                <li key={`${feature.properties.subId ?? "x"}-${index}`}>
                  <button type="button" onClick={() => selectSighting(feature)}>
                    {feature.properties.comName} at {feature.properties.locName},{" "}
                    {feature.properties.regionCode},{" "}
                    {formatShortDateTime(feature.properties.obsDt)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading ? (
          <div className="map-note loading" role="status" aria-live="polite">
            <Radar size={13} className="spin" />
            Reading checklists
          </div>
        ) : null}

        {error && selectedSpecies && !loading ? (
          <div className="map-note alert" role="alert">
            <span>{error}</span>
            {/* Retrying cannot fix "no states selected" — the fix lives behind
                the menu pill, so send the reader there instead. */}
            {selectedRegions.length ? (
              <button type="button" onClick={() => void loadSightings({ force: true })}>Retry</button>
            ) : (
              <button type="button" onClick={() => setDrawer("menu")}>Pick states</button>
            )}
          </div>
        ) : null}

        {failedRegionSummary && !error && !loading ? (
          <div className="map-note alert" role="status">
            <span>Partial results · no response for {failedRegionSummary}</span>
            <button type="button" onClick={() => void loadSightings({ force: true })}>Retry</button>
          </div>
        ) : null}

        {!selectedSpecies ? (
          <div className="map-empty" role="status">
            <Feather size={22} />
            <h2>{unknownCode ? "We don't know that bird" : "Choose a bird"}</h2>
            <p>
              {unknownCode ? (
                <>
                  That link asked for the species code <strong>{unknownCode}</strong>, which is not in
                  eBird's taxonomy. Pick a bird instead.
                </>
              ) : selectedRegions.length ? (
                <>
                  Pick any of {presets.length.toLocaleString()} species and Flockline charts where it has
                  been reported across {selectedRegionSummary}.
                </>
              ) : (
                // Interpolating the summary here read "reported across No
                // states selected." Say what to do about it instead.
                <>No states are selected. Choose some from Menu, then pick a bird.</>
              )}
            </p>
            <button type="button" className="pill" onClick={openPicker}>
              <Search size={13} />
              Browse species
            </button>
          </div>
        ) : null}

        {selectedSpecies && !loading && payload && !allFeatures.length ? (
          <div className="map-empty" role="status">
            <Search size={22} />
            <h2>No reports found</h2>
            <p>
              Nothing for {selectedSpecies.comName} in {selectedRegionSummary} over the past{" "}
              {lookbackDays} {lookbackDays === 1 ? "day" : "days"}.
              {narrowingFilters.length
                ? ` Filters are also narrowing this view: ${narrowingFilters.join(", ")}. Reports may exist outside them.`
                : allStatesSelected
                  ? " This bird may not occur here at all."
                  : " It may simply be out of range for these states."}
            </p>
            {/* Offer the action that can actually help. A narrowing filter is the
                one cause the reader cannot see from the map, so clearing it comes
                first. At 30 days the old "Widen to 30 days" button was already a
                no-op, which is exactly the case a bird that is out of range lands
                in. */}
            {narrowingFilters.length ? (
              <button
                type="button"
                className="pill"
                onClick={() => {
                  setIncludeProvisional(true);
                  setHotspotsOnly(false);
                }}
              >
                <RotateCcw />
                Clear filters
              </button>
            ) : lookbackDays < 30 ? (
              <button type="button" className="pill" onClick={() => setLookbackDays(30)}>
                Widen to 30 days
              </button>
            ) : !allStatesSelected ? (
              <button type="button" className="pill" onClick={() => selectRegionPreset("nationwide")}>
                <MapIcon />
                Search all states
              </button>
            ) : (
              <button type="button" className="pill" onClick={openPicker}>
                <Search size={13} />
                Try another bird
              </button>
            )}
          </div>
        ) : null}

        {selectedSighting ? (
          <aside className="sighting-sheet" aria-label="Sighting details">
            <header>
              <span className="sighting-kicker">Field record</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedSighting(null)}
                aria-label="Close sighting details"
              >
                <X size={15} />
              </button>
            </header>
            <h2>{selectedSighting.properties.comName}</h2>
            <p className="sighting-science">{selectedSighting.properties.sciName}</p>
            <div className="sighting-place">
              <MapPin size={14} />
              <span>
                <strong>{selectedSighting.properties.locName}</strong>
                <small>
                  {selectedSighting.properties.regionCode} ·{" "}
                  {formatShortDateTime(selectedSighting.properties.obsDt)}
                </small>
              </span>
            </div>
            <div className="sighting-facts">
              <span>
                <strong>{sightingDetails?.observation?.count ?? selectedSighting.properties.howMany ?? "X"}</strong>
                <small>Reported</small>
              </span>
              <span>
                <strong>{selectedSighting.properties.obsReviewed ? "Reviewed" : "Recent"}</strong>
                <small>Status</small>
              </span>
              <span>
                <strong>{selectedSighting.properties.locationPrivate ? "Approx." : "Public"}</strong>
                <small>Location</small>
              </span>
            </div>

            {selectedSighting.properties.subId && /^S\d+$/.test(selectedSighting.properties.subId) ? (
              <section className="sighting-details" aria-live="polite">
                <header>
                  <span><Database size={11} /> Checklist detail</span>
                  {sightingDetailsLoading ? <RefreshCw className="spin" size={11} /> : null}
                </header>
                {sightingDetailsLoading ? (
                  <div className="detail-skeleton" aria-label="Loading checklist details">
                    <span />
                    <span />
                  </div>
                ) : sightingDetailsError ? (
                  <p className="detail-error">
                    {sightingDetailsError} The checklist link below still opens the full record.
                  </p>
                ) : sightingDetails ? (
                  <>
                    {sightingDetails.observerName ? (
                      <div className="detail-observer">
                        <UserRound size={14} />
                        <span>
                          <small>Reported by</small>
                          <strong>{sightingDetails.observerName}</strong>
                        </span>
                      </div>
                    ) : null}
                    <div className="detail-meta">
                      {checklistEffort(sightingDetails) ? (
                        <span><Route size={11} /> {checklistEffort(sightingDetails)}</span>
                      ) : null}
                      {sightingDetails.numSpecies !== null ? (
                        <span>
                          <ListChecks size={11} /> {sightingDetails.numSpecies}{" "}
                          {pluralize("species", sightingDetails.numSpecies)}
                        </span>
                      ) : null}
                      {sightingDetails.numObservers !== null ? (
                        <span>
                          <UsersRound size={11} /> {sightingDetails.numObservers}{" "}
                          {pluralize("observer", sightingDetails.numObservers)}
                        </span>
                      ) : null}
                      {sightingDetails.allObsReported !== null ? (
                        <span>
                          <Check size={11} />{" "}
                          {sightingDetails.allObsReported ? "Complete" : "Partial"}
                        </span>
                      ) : null}
                    </div>
                    {sightingDetails.observation?.breedingCode || sightingDetails.observation?.exoticCategory ? (
                      <div className="detail-tags">
                        {sightingDetails.observation.breedingCode ? (
                          <span>Breeding {sightingDetails.observation.breedingCode}</span>
                        ) : null}
                        {sightingDetails.observation.exoticCategory ? (
                          <span>{sightingDetails.observation.exoticCategory}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {sightingDetails.observation?.comments ? (
                      <div className="detail-note">
                        <span>Species note</span>
                        <p>{sightingDetails.observation.comments}</p>
                      </div>
                    ) : null}
                    {sightingDetails.checklistComments ? (
                      <div className="detail-note">
                        <span>Checklist note</span>
                        <p>{sightingDetails.checklistComments}</p>
                      </div>
                    ) : null}
                    {sightingDetails.observation && totalMedia(sightingDetails.observation.media) > 0 ? (
                      <div className="detail-media">
                        {sightingDetails.observation.media.photos ? (
                          <span><Camera size={11} /> {sightingDetails.observation.media.photos}</span>
                        ) : null}
                        {sightingDetails.observation.media.audio ? (
                          <span><AudioLines size={11} /> {sightingDetails.observation.media.audio}</span>
                        ) : null}
                        {sightingDetails.observation.media.videos ? (
                          <span><Video size={11} /> {sightingDetails.observation.media.videos}</span>
                        ) : null}
                        <small>on eBird</small>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}

            <footer>
              <button type="button" onClick={() => void shareSighting(selectedSighting)}>
                {sightingShareStatus === "Copied" ? <Check size={11} /> : <Share2 size={11} />}
                {sightingShareStatus || "Share"}
              </button>
              <button
                type="button"
                className={watchlist.includes(selectedSighting.properties.speciesCode) ? "active" : ""}
                onClick={() => toggleWatched(selectedSighting.properties.speciesCode)}
              >
                <Star size={11} />
                {watchlist.includes(selectedSighting.properties.speciesCode) ? "Watching" : "Watch"}
              </button>
              {selectedSighting.properties.subId ? (
                <a
                  href={`https://ebird.org/checklist/${selectedSighting.properties.subId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Checklist <ExternalLink size={11} />
                </a>
              ) : null}
            </footer>
          </aside>
        ) : null}

          <div className="chrome">
            <div className={`chrome-bottom ${selectedSighting ? "beside-record" : ""}`}>
              {selectedSpecies && dateKeys.length ? (
                <div className="scrubber" aria-label="Timeline">
                  <div className="scrubber-head">
                    <button
                      type="button"
                      className="play-button"
                      onClick={() => (playing ? setPlaying(false) : startPlayback())}
                      aria-label={playing ? "Pause timeline" : "Play timeline"}
                    >
                      {playing ? <Pause /> : <Play />}
                    </button>
                    <span className="scrubber-date">
                      {timelineMode === "daily"
                        ? formatDateKey(selectedDateKey)
                        : `${formatDateKey(earliestDateKey)} – ${formatDateKey(selectedDateKey)}`}
                    </span>
                    <span className="spacer" />
                    <div className="segmented" role="group" aria-label="Timeline mode">
                      <button
                        type="button"
                        className={timelineMode === "daily" ? "active" : ""}
                        aria-pressed={timelineMode === "daily"}
                        onClick={() => setTimelineMode("daily")}
                        title="Only locations whose most recent report is the selected day"
                      >
                        New
                      </button>
                      <button
                        type="button"
                        className={timelineMode === "cumulative" ? "active" : ""}
                        aria-pressed={timelineMode === "cumulative"}
                        onClick={() => setTimelineMode("cumulative")}
                        title="Every location reported through the selected day"
                      >
                        Trail
                      </button>
                    </div>
                  </div>

                  <div className="histogram" role="group" aria-label="Locations by latest report date">
                    {dateKeys.map((key, index) => {
                      const count = dailyCounts[index];
                      const height = maxDaily ? Math.max(6, Math.round((count / maxDaily) * 100)) : 6;
                      const bucket = recencyBucket(index, dateKeys.length);
                      const position =
                        index === selectedDayIndex ? "current" : index < selectedDayIndex ? "past" : "future";
                      return (
                        <button
                          type="button"
                          key={key}
                          className={`${bucket} ${position}`}
                          style={{ height: `${height}%` }}
                          onClick={() => {
                            setPlaying(false);
                            setSelectedDayIndex(index);
                          }}
                          aria-label={`${formatDateKey(key)}: ${count.toLocaleString()} ${count === 1 ? "location" : "locations"} last reported`}
                          title={`${formatDateKey(key)} · ${count.toLocaleString()} last reported`}
                        />
                      );
                    })}
                  </div>

                  <input
                    type="range"
                    className="day-rail"
                    min={0}
                    max={Math.max(0, lookbackDays - 1)}
                    value={selectedDayIndex}
                    onChange={(event) => {
                      setPlaying(false);
                      setSelectedDayIndex(Number(event.target.value));
                    }}
                    aria-label="Timeline day"
                  />

                  <div className="scrubber-foot">
                    {timelineMode === "cumulative" ? (
                      <span>
                        <strong>{visibleStats.sightings.toLocaleString()}</strong> locations through{" "}
                        {formatDateKey(selectedDateKey)}
                      </span>
                    ) : (
                      <span>
                        <strong>{visibleStats.sightings.toLocaleString()}</strong> last reported{" "}
                        {formatDateKey(selectedDateKey)}
                        {/* With nothing in the window there is no fuller view to
                            switch to, so the link would read "see all 0". */}
                        {allFeatures.length ? " · " : null}
                        {allFeatures.length ? (
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setTimelineMode("cumulative");
                              setSelectedDayIndex(lookbackDays - 1);
                            }}
                          >
                            see all {allFeatures.length.toLocaleString()}
                          </button>
                        ) : null}
                      </span>
                    )}
                    <span className="ramp-key" title="Marker color shows how recent each report is">
                      <i className="old" />
                      <i className="mid" />
                      <i className="new" />
                      older → fresh
                    </span>
                  </div>
                </div>
              ) : null}

              <nav className="tab-bar" aria-label="Panels">
                <button
                  type="button"
                  className={`tab-map ${drawer === null ? "active" : ""}`}
                  onClick={() => setDrawer(null)}
                  aria-pressed={drawer === null}
                >
                  <MapIcon />
                  <span className="label">Map</span>
                </button>
                <button
                  type="button"
                  className={`tab-insights ${drawer === "insights" ? "active" : ""}`}
                  onClick={() => openDrawer("insights")}
                  aria-expanded={drawer === "insights"}
                >
                  <Sparkles />
                  <span className="label">Insights</span>
                </button>
                <button
                  type="button"
                  className={`tab-ask ${drawer === "ask" ? "active" : ""}`}
                  onClick={() => openDrawer("ask")}
                  aria-expanded={drawer === "ask"}
                >
                  <MessageCircle />
                  <span className="label">Ask</span>
                </button>
                <button
                  type="button"
                  className={`tab-birds ${drawer === "birds" ? "active" : ""}`}
                  onClick={() => openDrawer("birds")}
                  aria-expanded={drawer === "birds"}
                >
                  {activeAlertFindings.length ? <BellRing /> : <Star />}
                  <span className="label">My birds</span>
                  {watchlist.length ? <span className="badge">{watchlist.length}</span> : null}
                </button>
              </nav>
          </div>
          </div>
        </div>
      </div>

      {/* ---- Species picker -------------------------------------------- */}
      {pickerOpen ? (
        <>
          <div className="picker-backdrop" onClick={closePicker} />
          <div className="picker" ref={pickerRef} role="dialog" aria-modal="true" aria-label="Choose a species">
            <div className="picker-head">
              <span className="script">of the {presets.length.toLocaleString()} birds on file</span>
              <h2>Choose a bird</h2>
              {/* Every other overlay in the app has a visible X. Without one
                  here the only ways out were Escape and a backdrop click,
                  neither of which is discoverable on a touch screen. */}
              <button type="button" className="icon-btn picker-close" onClick={closePicker} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            <div className="search">
              <Search />
              <input
                ref={searchInputRef}
                value={speciesQuery}
                autoFocus
                placeholder="Search by name or eBird code…"
                onChange={(event) => {
                  setSpeciesQuery(event.target.value);
                  // Search is global, and the family row hides while it runs.
                  // Leaving the family set meant clearing the search dropped
                  // you back into a filter you could no longer see.
                  if (event.target.value.trim()) {
                    setSpeciesGroup("All");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  if (commitSearch()) {
                    // closePicker() focuses the masthead button synchronously.
                    // Without this the still-in-flight Enter then lands on that
                    // button as a keypress, activates it, and reopens the picker
                    // on a blank search, so committing a search looked like it
                    // had been thrown away.
                    event.preventDefault();
                    closePicker();
                    return;
                  }
                  // Ambiguous query: hand the reader the list rather than
                  // guessing, and never leave Enter feeling inert.
                  const first = speciesGridRef.current?.querySelector("button");
                  if (first) {
                    event.preventDefault();
                    first.focus();
                  }
                }}
                aria-label="Species name or eBird species code"
              />
              {speciesQuery ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setSpeciesQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <X />
                </button>
              ) : null}
            </div>

            {speciesQuery.trim() ? null : (
              <div className="picker-tabs" role="group" aria-label="Species families">
                {libraryGroups.map((group) => (
                  <button
                    type="button"
                    key={group}
                    className={speciesGroup === group ? "active" : ""}
                    aria-pressed={speciesGroup === group}
                    onClick={() => setSpeciesGroup(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
            )}

            <div className="picker-results" ref={speciesGridRef}>
              {pickerResults.length ? (
                pickerResults.map((species) => {
                  const isActive = selectedSpecies?.speciesCode === species.speciesCode;
                  return (
                    <button
                      type="button"
                      key={species.speciesCode}
                      className={isActive ? "active" : ""}
                      aria-pressed={isActive}
                      onClick={() => {
                        selectSpecies(species);
                        closePicker();
                      }}
                    >
                      <strong>{species.comName}</strong>
                      <small>{species.speciesCode}</small>
                    </button>
                  );
                })
              ) : searchFailed ? (
                <p className="picker-empty">
                  Search is unavailable right now. Check your connection and try again.
                </p>
              ) : (
                <p className="picker-empty">No birds match that search.</p>
              )}
            </div>

            <div className="picker-foot">
              <span>
                {pickerResults.length.toLocaleString()}
                {!speciesQuery.trim() && filteredCatalog.length > pickerResults.length
                  // Not "search to narrow": search reaches the whole eBird
                  // taxonomy, which is wider than the birds on file, so the
                  // old copy promised a subset and delivered a superset.
                  ? ` of ${filteredCatalog.length.toLocaleString()} · search all eBird species`
                  // Search caps at 28. Saying so, and how many matched, stops a
                  // common bird past the cap from looking like it is missing.
                  : speciesQuery.trim() && searchTotal > pickerResults.length
                    ? ` of ${searchTotal.toLocaleString()} matches · keep typing to narrow`
                    : " shown"}
              </span>
              {selectedSpecies ? (
                <button
                  type="button"
                  onClick={() => {
                    clearSpecies();
                    closePicker();
                  }}
                >
                  Clear selection
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {/* ---- Drawer ----------------------------------------------------- */}
      {drawer ? (
        <aside className="drawer" id="drawer-panel" role="dialog" aria-label={DRAWER_TITLES[drawer]}>
          <header className="drawer-head">
            <div>
              <span className="drawer-kicker">
                {drawer === "insights"
                  ? insightsScopeLabel
                  : drawer === "ask"
                    ? "Live from eBird"
                    : drawer === "birds"
                      ? "Saved on this device"
                      : "Coverage and filters"}
              </span>
              <h2>{DRAWER_TITLES[drawer]}</h2>
            </div>
            <div className="drawer-head-actions">
              {drawer === "insights" ? (
                <>
                  <button
                    type="button"
                    className={`icon-btn ${insightLinkStatus === "Link copied" ? "success" : ""}`}
                    onClick={() => void copyInsightsLink()}
                    title={insightLinkStatus || "Copy a link to these insights"}
                    aria-label={insightLinkStatus || "Copy a link to these insights"}
                  >
                    {insightLinkStatus === "Link copied" ? <Check /> : <Link2 />}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void loadInsights({ fresh: true })}
                    disabled={insightsLoading}
                    title="Re-run insights"
                    aria-label="Re-run insights"
                  >
                    <RefreshCw className={insightsLoading ? "spin" : ""} />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDrawer(null)}
                aria-label={`Close ${DRAWER_TITLES[drawer]}`}
              >
                <X />
              </button>
            </div>
          </header>

          {/* ---- Menu ---- */}
          {drawer === "menu" ? (
            <>
              <div className="drawer-body" id="drawer-region">
                <div className="field">
                  <span className="field-label">Region</span>
                  <div className="chips">
                    {US_REGION_PRESETS.map((region) => (
                      <button
                        type="button"
                        key={region.id}
                        className={selectedRegionPreset?.id === region.id ? "active" : ""}
                        aria-pressed={selectedRegionPreset?.id === region.id}
                        onClick={() => selectRegionPreset(region.id)}
                      >
                        {region.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">
                    {focusedRegion?.id === "nationwide" ? "All states" : `${focusedRegion?.name} states`}
                    <span className="spacer" />
                    <button type="button" onClick={selectAllRegions} disabled={allRegionsSelected}>
                      All
                    </button>
                    <button type="button" onClick={clearRegions} disabled={!selectedRegions.length}>
                      None
                    </button>
                  </span>
                  <div className="chips states">
                    {visibleRegionStates.map((state) => (
                      <button
                        type="button"
                        key={state.code}
                        className={selectedRegions.includes(state.code) ? "active" : ""}
                        aria-pressed={selectedRegions.includes(state.code)}
                        aria-label={state.name}
                        title={state.name}
                        onClick={() => toggleRegion(state.code)}
                      >
                        {state.abbr}
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">
                    {selectedRegions.length
                      ? `${selectedRegions.length} ${selectedRegions.length === 1 ? "state" : "states"} selected.`
                      : "Select at least one state to load sightings."}
                  </p>
                </div>

                <div className="field">
                  <span className="field-label">Filters</span>
                  <label className="toggle-row">
                    <span>
                      <strong>Provisional</strong>
                      <small>Include recent reports not yet reviewed by eBird editors.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={includeProvisional}
                      onChange={(event) => setIncludeProvisional(event.target.checked)}
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Hotspots only</strong>
                      <small>Public eBird hotspots only, not personal locations.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={hotspotsOnly}
                      onChange={(event) => setHotspotsOnly(event.target.checked)}
                    />
                  </label>
                </div>

                <div className="field">
                  <span className="field-label">Track now</span>
                  <div className="chips">
                    {featuredSpecies.map((species) => (
                      <button
                        type="button"
                        key={species.speciesCode}
                        className={selectedSpecies?.speciesCode === species.speciesCode ? "active" : ""}
                        aria-pressed={selectedSpecies?.speciesCode === species.speciesCode}
                        onClick={() => selectSpecies(species)}
                      >
                        {species.comName}
                      </button>
                    ))}
                  </div>
                </div>

                {/* The top bar drops the tour and share pills on narrow
                    screens, so both stay reachable from here. */}
                <div className="field">
                  <span className="field-label">This view</span>
                  <div className="menu-actions">
                    <button type="button" className="pill" onClick={() => void shareView()}>
                      {shareStatus === "Link copied" ? <Check /> : <Share2 />}
                      {shareStatus || "Copy link"}
                    </button>
                    <button type="button" className="pill" onClick={openTour}>
                      <Compass />
                      Take the tour
                    </button>
                    <a className="pill" href="#methodology">
                      <BookOpen />
                      How to read this
                    </a>
                  </div>
                </div>
              </div>
              <footer className="drawer-foot">
                Source · eBird / Cornell Lab of Ornithology
                <br />
                {presets.length.toLocaleString()} species on file
              </footer>
            </>
          ) : null}

          {/* ---- Insights ---- */}
          {drawer === "insights" ? (
            <>
              <div className="drawer-body">
                <div className="insights-scope">
                  <div className="scope-row">
                    <select
                      className="scope-select"
                      // Reflect "following the map" explicitly. Deriving this
                      // from the effective scope made the select already read
                      // e.g. "Northeast" while unpinned, so choosing Northeast
                      // fired no change event and pinning it was impossible.
                      value={insightRegions === null ? "map" : (insightRegionPreset?.id ?? "custom")}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === "map") {
                          setInsightRegions(null);
                          return;
                        }
                        const region = getRegionPreset(next);
                        if (region) {
                          const available = new Set(states.map((state) => state.code));
                          setInsightRegions(region.stateCodes.filter((code) => available.has(code)));
                        }
                      }}
                      aria-label="Insights region"
                    >
                      {US_REGION_PRESETS.map((region) => (
                        <option key={region.id} value={region.id}>{region.name}</option>
                      ))}
                      {insightRegionPreset ? null : (
                        <option value="custom">{insightsScopeLabel}</option>
                      )}
                      <option value="map">Match the map</option>
                    </select>
                  </div>

                  <div className="scope-row">
                    <div className="segmented" role="group" aria-label="Insights window">
                      {WINDOW_PRESETS.map((days) => (
                        <button
                          type="button"
                          key={days}
                          className={effectiveInsightBack === days ? "active" : ""}
                          aria-pressed={effectiveInsightBack === days}
                          onClick={() => setInsightBack(days)}
                          title={`Past ${days} ${days === 1 ? "day" : "days"}`}
                        >
                          {days}D
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="scope-note">
                    <span>
                      {insightsPinned ? "Pinned scope" : "Following the map"} · past{" "}
                      {effectiveInsightBack} {effectiveInsightBack === 1 ? "day" : "days"}
                    </span>
                    {insightsPinned ? (
                      <button
                        type="button"
                        onClick={() => {
                          setInsightRegions(null);
                          setInsightBack(null);
                        }}
                      >
                        Reset
                      </button>
                    ) : null}
                    {insightsStale && !insightsLoading ? (
                      <button type="button" onClick={() => void loadInsights()}>
                        Update
                      </button>
                    ) : null}
                  </div>

                  {insightsWiderThanMap ? (
                    <p className="field-hint">
                      Insights cover more ground than the map, which is showing{" "}
                      {selectedRegionSummary}. Opening a finding adds its state to the map.
                    </p>
                  ) : null}

                  {insights?.coverage.failedRegions.length ? (
                    <p className="field-hint" role="status">
                      Partial data · eBird did not respond for{" "}
                      {insights.coverage.failedRegions.length}{" "}
                      {insights.coverage.failedRegions.length === 1 ? "state" : "states"}.
                    </p>
                  ) : null}

                  {/* A failed re-run must not take the reader's findings away.
                      The loaded list stays below and the failure is reported
                      here; when the list is stale the copy says so, since the
                      header kicker is already showing the new scope. */}
                  {insightsError && insights?.findings.length ? (
                    <p className="field-hint error" role="status">
                      Update failed · {insightsError} Showing the last results
                      {insightsStale ? " from the previous scope" : ""}.
                    </p>
                  ) : null}
                </div>

                {/* Results land asynchronously, so a screen reader needs a
                    spoken cue. It is a short summary in its own status region:
                    marking the card list live would re-read every finding each
                    time the scope changes. */}
                <span className="sr-only" role="status" aria-live="polite">
                  {insightsAnnouncement}
                </span>

                {/* `!insights` covers the gap between opening the panel and the
                    debounced request starting. Without it that window fell
                    through to the empty state, so the panel announced "no
                    notable sightings" before it had looked. */}
                {insightsLoading || (!insights && !insightsError) ? (
                  <p className="drawer-status">Reading recent checklists…</p>
                ) : insightsError && !insights?.findings.length ? (
                  <p className="drawer-status error">{insightsError}</p>
                ) : insights && insights.findings.length ? (
                  <div className="insights-list">
                    {insights.findings.map((finding: Insight, index) => (
                      <article
                        className={`insight-card ${finding.kind}`}
                        key={`${finding.speciesCode ?? "x"}-${index}`}
                      >
                        <span className="insight-kind">
                          {insightIcon(finding.kind)}
                          {finding.kind === "wide" ? "Widespread" : finding.kind === "surge" ? "Cluster" : "Rarity"}
                        </span>
                        <h3>{finding.title}</h3>
                        <p>{finding.detail}</p>
                        <div className="insight-meta">
                          {finding.region ? (
                            <span>
                              <MapPin size={11} />
                              {finding.region}
                            </span>
                          ) : null}
                          {finding.speciesCode ? (
                            <button type="button" onClick={() => showFindingOnMap(finding)}>
                              View on map
                            </button>
                          ) : null}
                          {finding.subId ? (
                            <a
                              href={`https://ebird.org/checklist/${finding.subId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Checklist
                              <ExternalLink size={11} />
                            </a>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="drawer-status">
                    No notable sightings in {insightsScopeLabel} over the past {effectiveInsightBack}{" "}
                    {effectiveInsightBack === 1 ? "day" : "days"}.
                  </p>
                )}
              </div>
              {insights ? (
                <footer className="drawer-foot">
                  {insights.generator === "llm" ? "Written by Claude" : "From eBird notable sightings"} ·
                  updated {formatShortDateTime(insights.generatedAt)}
                </footer>
              ) : null}
            </>
          ) : null}

          {/* ---- Ask ---- */}
          {drawer === "ask" ? (
            <>
              <div className="chat-scroll" ref={chatScrollRef}>
                {chatMessages.length === 0 ? (
                  <p className="chat-intro">
                    Ask about recent sightings, rare birds, or what is active near you. Answers come
                    live from eBird checklists, and the assistant can move the map for you.
                  </p>
                ) : (
                  chatMessages.map((message, index) => (
                    <div className={`chat-msg ${message.role}`} key={index}>
                      <span className="who">{message.role === "user" ? "You" : "Flockline"}</span>
                      <div className="chat-bubble">
                        {renderChatText(message.content)}
                        {message.role === "assistant" && message.speciesRefs?.length ? (
                          <div className="chat-refs">
                            {message.speciesRefs.map((ref) => (
                              <button
                                type="button"
                                key={ref.speciesCode}
                                onClick={() => viewSpeciesFromChat(ref)}
                              >
                                <MapPin size={10} />
                                {ref.comName}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}

                {chatLoading ? (
                  <div className="chat-msg assistant">
                    <span className="who">Flockline</span>
                    <div className="chat-bubble chat-typing" aria-label="Checking eBird">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : null}

                {chatError ? <p className="chat-error">{chatError}</p> : null}
              </div>

              {/* The reply arrives in one piece, so announce it once from a
                  status region. aria-live on the transcript itself would re-read
                  the whole thread on every turn. */}
              <span className="sr-only" role="status" aria-live="polite">
                {chatAnnouncement}
              </span>

              {chatMessages.length === 0 && chatSuggestions.length ? (
                <div className="chat-suggestions">
                  {chatSuggestions.map((prompt) => (
                    <button type="button" key={prompt} onClick={() => void sendChat(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}

              <form
                className="chat-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat(chatInput);
                }}
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask about birds nearby…"
                  aria-label="Ask the Flockline assistant"
                />
                <button
                  type="submit"
                  className="chat-send"
                  disabled={chatLoading || !chatInput.trim()}
                  aria-label="Send"
                >
                  <Send />
                </button>
              </form>
            </>
          ) : null}

          {/* ---- My birds ---- */}
          {drawer === "birds" ? (
            <>
              <div className="drawer-body">
                {activeAlertFindings.length ? (
                  <div className="watch-alert" role="status">
                    <BellRing />
                    <span>
                      <strong>
                        {activeAlertFindings.length} field{" "}
                        {activeAlertFindings.length === 1 ? "alert" : "alerts"}
                      </strong>
                      <small>
                        {activeAlertFindings.map((finding) => finding.comName || finding.title).join(" · ")}
                      </small>
                    </span>
                  </div>
                ) : null}

                {watchlistSpecies.length ? (
                  <div className="watch-list">
                    {watchlistSpecies.map((species) => {
                      const finding = insights?.findings.find(
                        (item) => item.speciesCode === species.speciesCode
                      );
                      const alertOn = alerts.includes(species.speciesCode);
                      return (
                        <article className="watch-row" key={species.speciesCode}>
                          {BIRD_ART[species.speciesCode] ? (
                            <img src={BIRD_ART[species.speciesCode]} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <span className="thumb"><Bird size={18} /></span>
                          )}
                          <button
                            type="button"
                            className="pick"
                            onClick={() => {
                              selectSpecies(species);
                              if (!isWide) setDrawer(null);
                            }}
                          >
                            <strong>{species.comName}</strong>
                            <small>{finding ? finding.title : species.group}</small>
                          </button>
                          <button
                            type="button"
                            className={`icon-btn ${alertOn ? "on" : ""}`}
                            onClick={() => toggleAlert(species.speciesCode)}
                            aria-label={
                              alertOn
                                ? `Turn off field alerts for ${species.comName}`
                                : `Turn on field alerts for ${species.comName}`
                            }
                            title={alertOn ? "Field alerts on" : "Turn on field alerts"}
                          >
                            {alertOn ? <BellRing /> : <Bell />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => toggleWatched(species.speciesCode)}
                            aria-label={`Remove ${species.comName} from My birds`}
                          >
                            <X />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="watch-empty">
                    <Star />
                    <h3>Your field board</h3>
                    <p>Star a bird from any sighting to keep it here, then turn on alerts for notable reports.</p>
                    <div className="chips">
                      {featuredSpecies.slice(0, 3).map((species) => (
                        <button
                          type="button"
                          key={species.speciesCode}
                          onClick={() => toggleWatched(species.speciesCode)}
                        >
                          + {species.comName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* The starter chips only exist in the empty state, so the panel
                    lost every route back to the catalog the moment a first bird
                    was saved. This row is that route. */}
                {watchlistSpecies.length ? (
                  <div className="watch-add">
                    <button
                      type="button"
                      className="pill"
                      onClick={() => {
                        // On narrow the drawer is a full-height sheet: leaving it open
                        // would hide the bird just picked and the star that saves it.
                        if (!isWide) setDrawer(null);
                        openPicker();
                      }}
                    >
                      <Search size={13} />
                      Browse species
                    </button>
                    <p className="field-hint">Pick a bird, then star it to keep it here.</p>
                  </div>
                ) : null}
              </div>
              <footer className="drawer-foot">
                Field alerts surface notable eBird reports inside Flockline. Your choices stay on this device.
              </footer>
            </>
          ) : null}
        </aside>
      ) : null}

      <Tour open={tourOpen} steps={tourSteps} onClose={closeTour} />
      <span className="sr-only" role="status" aria-live="polite">{shareStatus}</span>
    </main>
  );
}

function buildDateKeys(days: number) {
  const keys: string[] = [];
  const now = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    keys.push(toDateKey(date));
  }
  return keys;
}

function todayKey() {
  return toDateKey(new Date());
}

function toDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function formatShortDateTime(value: string | null) {
  if (!value) {
    return "No records";
  }
  const dateKey = value.slice(0, 10);
  const time = value.slice(11, 16);
  return `${formatDateKey(dateKey)} ${time}`;
}

function normalizeSpecies(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameCodeSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((code, index) => code === sortedRight[index]);
}

function recencyBucket(index: number, length: number) {
  const ratio = length <= 1 ? 1 : index / (length - 1);
  if (ratio > 0.72) {
    return "new";
  }
  if (ratio > 0.36) {
    return "mid";
  }
  return "old";
}

function insightIcon(kind: InsightKind) {
  if (kind === "wide") {
    return <MapPin size={16} />;
  }
  if (kind === "surge") {
    return <TrendingUp size={16} />;
  }
  return <Feather size={16} />;
}

// Render the assistant's plain-text reply: paragraphs for prose, and grouped
// <ul> lists for runs of "- " bullet lines. We never interpret it as HTML, so
// the model's output can't inject markup.
function renderChatText(text: string): ReactNode {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };

  for (const line of lines) {
    const bullet = line.match(/^[-•*]\s+(.*)/);
    if (bullet) {
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      blocks.push(<p key={`p-${blocks.length}`}>{line}</p>);
    }
  }
  flushBullets();
  return blocks;
}

function getFeatureColor(feature: SightingFeature, dateKeys: string[]) {
  const dateIndex = dateKeys.indexOf(feature.properties.obsDt.slice(0, 10));
  const ratio = dateIndex < 0 || dateKeys.length <= 1 ? 1 : dateIndex / (dateKeys.length - 1);
  if (ratio > 0.72) {
    return "#cc2b1d";
  }
  if (ratio > 0.36) {
    return "#e8a317";
  }
  return "#3b7dd8";
}

function checklistEffort(details: ChecklistDetailsResponse) {
  return [
    details.protocolLabel,
    details.durationMinutes === null ? null : formatDuration(details.durationMinutes),
    details.distanceKm === null ? null : `${details.distanceKm.toFixed(details.distanceKm < 10 ? 1 : 0)} km`
  ].filter(Boolean).join(" · ");
}

function formatDuration(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function pluralize(word: string, count: number) {
  return count === 1 || word === "species" ? word : `${word}s`;
}

function totalMedia(media: ChecklistMedia) {
  return Object.values(media).reduce((sum, count) => sum + count, 0);
}

function buildInitialAppState(): Partial<AppState> {
  const validRegions = US_STATES.map((state) => state.code);
  const stored = readStoredObject<Partial<AppState>>(PREFERENCES_KEY) ?? {};
  const storedRegions = Array.isArray(stored.regions)
    ? stored.regions.filter((code) => validRegions.includes(code))
    : undefined;
  const preferences: Partial<AppState> = {
    ...(Number.isFinite(stored.lookbackDays)
      ? { lookbackDays: Math.min(30, Math.max(1, Number(stored.lookbackDays))) }
      : {}),
    ...(storedRegions ? { regions: storedRegions } : {}),
    ...(stored.timelineMode === "daily" || stored.timelineMode === "cumulative"
      ? { timelineMode: stored.timelineMode }
      : {}),
    ...(typeof stored.includeProvisional === "boolean" ? { includeProvisional: stored.includeProvisional } : {}),
    ...(typeof stored.hotspotsOnly === "boolean" ? { hotspotsOnly: stored.hotspotsOnly } : {})
  };
  const urlState = parseAppState(
    typeof window === "undefined" ? "" : window.location.search,
    validRegions,
    US_REGION_PRESETS
  );
  return { ...preferences, ...urlState };
}

function readStoredString(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStoredObject<T>(key: string): T | null {
  const raw = readStoredString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readStoredList(key: string) {
  const value = readStoredObject<unknown>(key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 50)
    : [];
}

function writeStoredJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Device persistence is optional; the current session remains functional.
  }
}
