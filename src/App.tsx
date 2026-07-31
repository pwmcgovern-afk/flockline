import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import {
  Bird,
  Bell,
  BellRing,
  BookOpen,
  Camera,
  CalendarDays,
  Check,
  Clock,
  Compass,
  Database,
  ExternalLink,
  AudioLines,
  Info,
  Layers,
  ListChecks,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Moon,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Route,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Feather,
  TrendingUp,
  UserRound,
  UsersRound,
  Video,
  X,
  Wifi,
  WifiOff
} from "lucide-react";
import Tour, { type TourStep } from "./Tour";
import { buildAppUrl, parseAppState, type AppState, type TimelineMode } from "./appState";
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
const defaultSpecies = defaultPresets.find((species) => species.speciesCode === "osprey") ?? defaultPresets[0];
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
const BIRD_ART: Record<string, string> = Object.fromEntries(
  featuredSpeciesCodes.map((code) => [code, `/birds/${code}.jpg`])
);
const WATCHLIST_KEY = "flockline.watchlist.v1";
const ALERTS_KEY = "flockline.alerts.v1";
const PREFERENCES_KEY = "flockline.preferences.v1";
const THEME_KEY = "flockline.theme.v1";
type AppTheme = "field" | "dusk";
type ChecklistMedia = NonNullable<ChecklistDetailsResponse["observation"]>["media"];

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

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function samplePrompts(pool: string[], count: number) {
  const copy = [...pool];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy.slice(0, count);
}

const TOUR_SEEN_KEY = "flockline.tourSeen";

// Walked through on first visit, and re-openable from the compass button.
// Steps whose target is hidden (e.g. the metric rail on mobile) are skipped.
const TOUR_STEPS: TourStep[] = [
  {
    side: "center",
    title: "Welcome to Flockline",
    body: "A live map of bird movement across the United States, drawn from eBird checklists. Here is the 30-second tour."
  },
  {
    target: ".active-species-card",
    side: "right",
    title: "Pick a species and states",
    body: "Search the nationwide species catalog and choose which states to include. The map plots their recent sightings right away."
  },
  {
    target: ".timeline-dock",
    side: "top",
    title: "Scrub the timeline",
    body: "Drag through the days to watch movement. Trail shows the full picture, New shows only the freshest reports per spot."
  },
  {
    target: ".metric-rail",
    side: "bottom",
    title: "Honest counts",
    body: "On map, in window, total birds, and states. Common birds are under-reported on eBird, so treat these as floors, not totals."
  },
  {
    target: ".insights-trigger",
    side: "bottom",
    title: "Insights",
    body: "A running list of the rarest and most notable birds in your selected states, refreshed through the day."
  },
  {
    target: ".field-brief",
    side: "left",
    title: "What’s moving now",
    body: "The live field brief turns notable eBird reports into a few timely birds worth exploring. Pick one to load it instantly."
  },
  {
    target: ".chat-trigger",
    side: "bottom",
    title: "Ask the assistant",
    body: "Ask anything about birds and their recent activity. Answers come back live from eBird, with spots and dates."
  },
  {
    target: ".watchlist-trigger",
    side: "bottom",
    title: "Build your field board",
    body: "Star birds to keep them in My birds, then turn on field alerts for notable reports. Your choices stay on this device."
  },
  {
    side: "center",
    title: "You're all set",
    body: "Reopen this tour anytime from the compass button in the header. Happy birding."
  }
];

export default function App() {
  const initialState = useRef(
    buildInitialAppState()
  ).current;
  const initialSpecies =
    initialState.speciesCode === null
      ? null
      : defaultPresets.find((species) => species.speciesCode === initialState.speciesCode) ?? defaultSpecies;
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const sightingLayerRef = useRef<L.LayerGroup | null>(null);
  const sightingsRequestRef = useRef<AbortController | null>(null);
  const lastFitKeyRef = useRef("");
  // When the chat asks to zoom to a spot, the next data load flies here
  // instead of fitting to all sightings.
  const pendingFocusRef = useRef<{ lat: number; lng: number } | null>(null);
  // Focus target for the species search and the scroll container for the browse
  // grid, so clearing/selecting can bring the right thing into view.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const speciesGridRef = useRef<HTMLDivElement | null>(null);

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
  const [searchFocused, setSearchFocused] = useState(false);
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
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [theme, setTheme] = useState<AppTheme>(() => readStoredString(THEME_KEY) === "dusk" ? "dusk" : "field");
  const [watchlist, setWatchlist] = useState<string[]>(() => readStoredList(WATCHLIST_KEY));
  const [alerts, setAlerts] = useState<string[]>(() => readStoredList(ALERTS_KEY));
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [showTourInvite, setShowTourInvite] = useState(() => {
    try {
      return !localStorage.getItem(TOUR_SEEN_KEY);
    } catch {
      return false;
    }
  });
  // Pending map action requested by the chat assistant (load species / zoom).
  const [pendingMapAction, setPendingMapAction] = useState<ChatMapAction | null>(null);
  // Wide screens dock the drawers (push the map over); narrow screens overlay.
  const [isWide, setIsWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches
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

  // Insights are scoped to the timeline window (lookbackDays). `fresh` forces a
  // regenerate past both the server's 6h cache and any CDN copy (unique URL).
  const loadInsights = useCallback(
    async (options?: { fresh?: boolean }) => {
      if (!selectedRegions.length) {
        setInsightsError("Select at least one state for Insights.");
        return;
      }
      setInsightsLoading(true);
      setInsightsError("");
      try {
        const params = new URLSearchParams({
          back: String(lookbackDays),
          regions: selectedRegions.join(",")
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
        setInsights(data);
      } catch (requestError) {
        setInsightsError(requestError instanceof Error ? requestError.message : "Insights request failed.");
      } finally {
        setInsightsLoading(false);
      }
    },
    [lookbackDays, selectedRegions]
  );

  const toggleInsights = () => {
    setInsightsOpen((open) => {
      const next = !open;
      if (next) {
        setChatOpen(false);
        setWatchlistOpen(false);
        // Load on open if we have nothing yet, or if the timeline window has
        // moved since the last run (cached result if it was seen recently).
        if (
          !insightsLoading
          && (!insights || insights.back !== lookbackDays || !sameCodeSet(insights.regions, selectedRegions))
        ) {
          void loadInsights();
        }
      }
      return next;
    });
  };

  const dateKeys = useMemo(() => buildDateKeys(lookbackDays), [lookbackDays]);
  const selectedDateKey = dateKeys[selectedDayIndex] ?? dateKeys[dateKeys.length - 1] ?? todayKey();
  const earliestDateKey = dateKeys[0] ?? selectedDateKey;
  const allFeatures = payload?.featureCollection.features ?? [];

  // New detections per day in the window (each feature = one location at its
  // most-recent report date), aligned to dateKeys for the timeline histogram.
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
    const features = payload?.featureCollection.features ?? [];
    const birds = features.reduce(
      (sum, feature) => sum + Math.max(1, Number(feature.properties.howMany) || 0),
      0
    );
    return { locations: features.length, birds };
  }, [payload]);

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
  const insightsScopeLabel = insights?.scopeLabel?.replace(/^the\s+/i, "") ?? selectedRegionSummary;
  const insightsStale = Boolean(
    insights
    && (insights.back !== lookbackDays || !sameCodeSet(insights.regions, selectedRegions))
  );
  const failedRegionSummary = useMemo(() => {
    return (payload?.coverage?.failedRegions ?? [])
      .map((code) => states.find((state) => state.code === code)?.abbr ?? code)
      .join(", ");
  }, [payload?.coverage?.failedRegions, states]);
  const filteredCatalog = useMemo(() => {
    return speciesGroup === "All" ? presets : presets.filter((species) => species.group === speciesGroup);
  }, [presets, speciesGroup]);
  const visibleCatalog = useMemo(() => {
    const preview = filteredCatalog.slice(0, CATALOG_PREVIEW_LIMIT);
    if (
      selectedSpecies &&
      filteredCatalog.some((species) => species.speciesCode === selectedSpecies.speciesCode) &&
      !preview.some((species) => species.speciesCode === selectedSpecies.speciesCode)
    ) {
      return [...preview.slice(0, -1), selectedSpecies];
    }
    return preview;
  }, [filteredCatalog, selectedSpecies]);
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
  const fieldBriefFindings = useMemo(
    () => {
      const live = (insights?.findings ?? []).filter((finding) => finding.speciesCode).slice(0, 3);
      if (live.length) return live;
      return featuredSpecies.slice(0, 3).map((species, index): Insight => ({
        kind: (["wide", "surge", "rarity"] as InsightKind[])[index],
        title: species.comName,
        detail: `Follow ${species.comName} reports across your selected states.`,
        speciesCode: species.speciesCode,
        comName: species.comName,
        generatedBy: "template"
      }));
    },
    [featuredSpecies, insights]
  );
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
        setPresets(nextConfig.presets);
        setSuggestions(nextConfig.presets);
        setSelectedRegions((current) => {
          const validCodes = nextConfig.states.map((state) => state.code);
          return current.filter((code) => validCodes.includes(code));
        });
      })
      .catch(() => {
        setConfig({ hasApiKey: false, states: defaultStates, presets: defaultPresets, maxBackDays: 30 });
      });
  }, []);

  useEffect(() => {
    if (
      !selectedRegions.length
      || (insights?.back === lookbackDays && sameCodeSet(insights.regions, selectedRegions))
      || insightsLoading
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void loadInsights(), 900);
    return () => window.clearTimeout(timeout);
  }, [insights?.back, insights?.regions, insightsLoading, loadInsights, lookbackDays, selectedRegions]);

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
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme still works for the current session when storage is blocked.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dusk" ? "#07110d" : "#166b3a");
    baseLayerRef.current?.setUrl(
      theme === "dusk"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    );
  }, [theme]);

  useEffect(() => {
    if (!speciesQuery.trim()) {
      setSuggestions(presets);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/species?q=${encodeURIComponent(speciesQuery)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data: { items: Species[] }) => setSuggestions(data.items.length ? data.items : presets))
        .catch(() => setSuggestions(presets));
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
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    }).setView([39.5, -98.35], 4);

    const baseLayer = L.tileLayer(
      theme === "dusk"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
      }
    ).addTo(map);
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

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      sightingLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (payload && allFeatures.length)) {
      return;
    }
    const centers = states
      .filter((state) => selectedRegions.includes(state.code))
      .map((state) => state.center);
    if (!centers.length) {
      map.setView([39.5, -98.35], 4, { animate: false });
      return;
    }
    if (centers.length === 1) {
      map.setView(centers[0], 6, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(centers).pad(0.35), {
      maxZoom: 6,
      animate: !prefersReducedMotion(),
      duration: 0.45
    });
  }, [allFeatures.length, payload, selectedRegions, states]);

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
      const marker = L.circleMarker([lat, lng], {
        radius: Math.min(11, 4.5 + Math.sqrt(count) * 1.8),
        color: "#ffffff",
        fillColor: color,
        fillOpacity: feature.properties.obsReviewed ? 0.95 : 0.62,
        opacity: 1,
        weight: feature.properties.locationPrivate ? 1 : 1.6
      });
      const openSighting = () => setSelectedSighting(feature);
      marker.on("click", openSighting);
      marker.addTo(layer);
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute(
          "aria-label",
          `${feature.properties.comName} at ${feature.properties.locName}, ${feature.properties.regionCode}, ${formatShortDateTime(feature.properties.obsDt)}`
        );
        markerElement.setAttribute("role", "button");
        markerElement.addEventListener("keydown", (event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
            event.preventDefault();
            openSighting();
          }
        });
      }
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
  }, [dateKeys, playing, selectedDateKey, visibleFeatures]);

  useEffect(() => {
    if (!payload || !mapRef.current) {
      return;
    }
    if (!allFeatures.length) {
      // Nothing to show for this load: drop any pending focus so it can't
      // fire later against an unrelated species' payload.
      pendingFocusRef.current = null;
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
      pendingFocusRef.current = null;
      lastFitKeyRef.current = fitKey;
      mapRef.current.setView([focus.lat, focus.lng], 11, { animate: false });
      return;
    }

    if (lastFitKeyRef.current === fitKey) {
      return;
    }
    lastFitKeyRef.current = fitKey;

    const bounds = L.latLngBounds(
      allFeatures.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number])
    );
    mapRef.current.fitBounds(bounds.pad(0.16), {
      maxZoom: 8,
      animate: !prefersReducedMotion(),
      duration: 0.55
    });
  }, [allFeatures, payload]);

  const selectSpecies = (species: Species) => {
    setSelectedSighting(null);
    setSelectedSpecies(species);
    setSpeciesQuery(species.comName);
    setSearchFocused(false);
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
    setSearchFocused(false);
    // Reset fit tracking: re-selecting the same species after a clear returns a
    // cached payload (same generatedAt), which would otherwise skip the re-fit.
    lastFitKeyRef.current = "";
    pendingFocusRef.current = null;
  };

  const openChat = () => {
    setInsightsOpen(false);
    setWatchlistOpen(false);
    const regionalPrompts = selectedRegionPreset
      ? REGIONAL_CHAT_PROMPTS[selectedRegionPreset.id] ?? []
      : [];
    const starterPrompts = regionalPrompts.length
      ? [...samplePrompts(regionalPrompts, 2), ...samplePrompts(CHAT_PROMPTS, 2)]
      : samplePrompts(CHAT_PROMPTS, 4);
    setChatSuggestions(samplePrompts(starterPrompts, 4));
    setChatOpen(true);
  };

  const toggleChat = () => {
    if (chatOpen) {
      setChatOpen(false);
    } else {
      openChat();
    }
  };

  const toggleWatchlist = () => {
    setWatchlistOpen((open) => {
      const next = !open;
      if (next) {
        setInsightsOpen(false);
        setChatOpen(false);
      }
      return next;
    });
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
        setChatError(requestError instanceof Error ? requestError.message : "Chat request failed.");
      } finally {
        setChatLoading(false);
      }
    },
    [chatMessages, chatLoading, selectedRegions]
  );

  const viewSpeciesFromChat = (ref: ChatSpeciesRef) => {
    selectSpecies({ speciesCode: ref.speciesCode, comName: ref.comName, sciName: "", group: "Species" });
    // When docked the panel sits beside the map, so keep it open; when it
    // overlays (narrow screens), close it so the map is visible.
    if (!isWide) {
      setChatOpen(false);
    }
  };

  // Keep the transcript pinned to the latest message as it grows.
  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [chatMessages, chatLoading, chatOpen]);

  // Apply a map action the chat requested: load the species and, if it named a
  // spot, zoom there (pendingFocusRef is consumed by the fit effect on reload).
  useEffect(() => {
    if (!pendingMapAction) {
      return;
    }
    const action = pendingMapAction;
    setPendingMapAction(null);
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
    // If it's already the active species, no reload fires the focus move, so do it now.
    if (sameSpecies && hasFocus && mapRef.current) {
      pendingFocusRef.current = null;
      mapRef.current.setView([action.lat as number, action.lng as number], 11, { animate: false });
    }
    // On narrow screens the chat covers the map, so close it to reveal the result.
    if (!isWide) {
      setChatOpen(false);
    }
  }, [pendingMapAction, selectedSpecies?.speciesCode, isWide]);

  // Track whether we're wide enough to dock the drawers (vs. overlay).
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const handler = (event: MediaQueryListEvent) => setIsWide(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  // When a drawer docks or undocks, the map container resizes, so Leaflet has
  // to re-measure after the slide transition or the tiles render at the old size.
  const docked = (insightsOpen || chatOpen || watchlistOpen) && isWide;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const timeout = window.setTimeout(() => map.invalidateSize({ animate: false }), 340);
    return () => window.clearTimeout(timeout);
  }, [docked]);

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

  const openTour = () => {
    setShowTourInvite(false);
    setTourOpen(true);
  };

  const closeTour = () => {
    setTourOpen(false);
    setShowTourInvite(false);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      // Ignore storage failures; worst case the tour shows again next visit.
    }
  };

  const dismissTourInvite = () => {
    setShowTourInvite(false);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      // The invite can still be dismissed for this session when storage is blocked.
    }
  };

  const commitSearch = () => {
    const match =
      suggestions.find((species) => normalizeSpecies(species.comName) === normalizeSpecies(speciesQuery)) ||
      suggestions.find((species) => normalizeSpecies(species.speciesCode) === normalizeSpecies(speciesQuery)) ||
      suggestions[0];
    if (match) {
      selectSpecies(match);
      return;
    }
    if (/^[a-z0-9]+$/i.test(speciesQuery.trim())) {
      selectSpecies({
        speciesCode: speciesQuery.trim().toLowerCase(),
        comName: speciesQuery.trim(),
        sciName: "",
        group: "Species"
      });
    }
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

  const currentAppUrl = useMemo(
    () =>
      buildAppUrl(
        window.location.href,
        {
          speciesCode: selectedSpecies?.speciesCode ?? null,
          lookbackDays,
          regions: selectedRegions,
          timelineMode,
          includeProvisional,
          hotspotsOnly
        },
        states.map((state) => state.code),
        US_REGION_PRESETS
      ),
    [hotspotsOnly, includeProvisional, lookbackDays, selectedRegions, selectedSpecies?.speciesCode, states, timelineMode]
  );

  useEffect(() => {
    window.history.replaceState(null, "", currentAppUrl);
  }, [currentAppUrl]);

  const shareView = async () => {
    try {
      await navigator.clipboard.writeText(currentAppUrl);
      setShareStatus("Link copied");
    } catch {
      setShareStatus("Copy failed");
    }
    window.setTimeout(() => setShareStatus(""), 1800);
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
  const sourceLabel = isLiveSource ? "Live eBird" : "Demo stream";

  return (
    <main className={`app-shell theme-${theme} ${docked ? "shell-docked" : ""}`}>
      <a className="skip-link" href="#species-controls">Skip to tracker controls</a>
      <section className={`map-stage ${playing ? "movement-playing" : ""}`} aria-label="Sightings map">
        <div ref={mapElementRef} className="map-canvas" />
        <div className="map-vignette" />
        {playing ? <div className="movement-sweep" aria-hidden="true" /> : null}
        {loading ? (
          <div className="loading-pill" role="status" aria-live="polite">
            <Radar size={16} />
            Scanning recent checklists
          </div>
        ) : null}
        {showTourInvite && !tourOpen && !loading ? (
          <div className="tour-invite" role="status">
            <span className="tour-invite-mark">
              <Compass size={18} />
            </span>
            <span>
              <strong>New to Flockline?</strong>
              <small>Take the 30-second field tour.</small>
            </span>
            <button type="button" onClick={openTour}>Start</button>
            <button type="button" className="tour-invite-close" onClick={dismissTourInvite} aria-label="Dismiss tour invitation">
              <X size={15} />
            </button>
          </div>
        ) : null}
        {!selectedSpecies ? (
          <div className="map-empty" role="status">
            <span className="map-empty-mark">
              <Feather size={26} />
            </span>
            <h2>Pick a species to begin</h2>
            <p>Choose any of {presets.length} birds to chart recent reports across {selectedRegionSummary}.</p>
          </div>
        ) : null}
        {selectedSpecies && !loading && payload && !allFeatures.length ? (
          <div className="map-empty no-results" role="status">
            <span className="map-empty-mark">
              <Search size={25} />
            </span>
            <h2>No recent reports found</h2>
            <p>Try a longer window, include provisional sightings, or add more states.</p>
          </div>
        ) : null}
        {error && selectedSpecies ? (
          <div className="map-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadSightings({ force: true })}>Try again</button>
          </div>
        ) : null}
        {failedRegionSummary && !error ? (
          <div className="map-alert partial" role="status">
            <span>Partial results. eBird did not respond for {failedRegionSummary}.</span>
            <button type="button" onClick={() => void loadSightings({ force: true })}>Retry</button>
          </div>
        ) : null}
        {!showTourInvite && !selectedSighting && fieldBriefFindings.length && !docked ? (
          <section className="field-brief" aria-label="What's moving now">
            <header>
              <span>
                <Sparkles size={14} />
                Live field brief
              </span>
              <small>{insights?.findings.length ? formatShortDateTime(insights.generatedAt) : "Curated picks"}</small>
            </header>
            <div>
              {fieldBriefFindings.map((finding, index) => (
                <button
                  type="button"
                  key={`${finding.speciesCode}-${index}`}
                  onClick={() => selectSpecies({
                    speciesCode: finding.speciesCode as string,
                    comName: finding.comName || finding.title,
                    sciName: "",
                    group: "Field brief"
                  })}
                >
                  <span className={`field-brief-kind ${finding.kind}`}>{insightIcon(finding.kind)}</span>
                  <span>
                    <strong>{finding.comName || finding.title}</strong>
                    <small>{finding.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {selectedSighting ? (
          <aside className="sighting-sheet" aria-label="Sighting details">
            <header>
              <span className="sighting-sheet-kicker">Fresh field record</span>
              <button type="button" onClick={() => setSelectedSighting(null)} aria-label="Close sighting details">
                <X size={17} />
              </button>
            </header>
            <h2>{selectedSighting.properties.comName}</h2>
            <p className="sighting-sheet-science">{selectedSighting.properties.sciName}</p>
            <div className="sighting-sheet-place">
              <MapPin size={15} />
              <span>
                <strong>{selectedSighting.properties.locName}</strong>
                <small>{selectedSighting.properties.regionCode} · {formatShortDateTime(selectedSighting.properties.obsDt)}</small>
              </span>
            </div>
            <div className="sighting-sheet-facts">
              <span><strong>{sightingDetails?.observation?.count ?? selectedSighting.properties.howMany ?? "X"}</strong> reported</span>
              <span><strong>{selectedSighting.properties.obsReviewed ? "Reviewed" : "Recent"}</strong> status</span>
              <span><strong>{selectedSighting.properties.locationPrivate ? "Approx." : "Public"}</strong> location</span>
            </div>
            {selectedSighting.properties.subId && /^S\d+$/.test(selectedSighting.properties.subId) ? (
              <section className="sighting-ebird-details" aria-live="polite">
                <header>
                  <span><Database size={13} /> eBird checklist details</span>
                  {sightingDetailsLoading ? <RefreshCw className="sighting-detail-spinner" size={13} /> : null}
                </header>
                {sightingDetailsLoading ? (
                  <div className="sighting-detail-loading" aria-label="Loading eBird checklist details">
                    <span />
                    <span />
                  </div>
                ) : sightingDetailsError ? (
                  <p className="sighting-detail-error">{sightingDetailsError} The checklist link below still opens the full record.</p>
                ) : sightingDetails ? (
                  <>
                    {sightingDetails.observerName ? (
                      <div className="sighting-detail-observer">
                        <UserRound size={15} />
                        <span><small>Reported by</small><strong>{sightingDetails.observerName}</strong></span>
                      </div>
                    ) : null}
                    <div className="sighting-detail-meta">
                      {checklistEffort(sightingDetails) ? (
                        <span><Route size={13} /> {checklistEffort(sightingDetails)}</span>
                      ) : null}
                      {sightingDetails.numSpecies !== null ? (
                        <span><ListChecks size={13} /> {sightingDetails.numSpecies} {pluralize("species", sightingDetails.numSpecies)}</span>
                      ) : null}
                      {sightingDetails.numObservers !== null ? (
                        <span><UsersRound size={13} /> {sightingDetails.numObservers} {pluralize("observer", sightingDetails.numObservers)}</span>
                      ) : null}
                      {sightingDetails.allObsReported !== null ? (
                        <span><Check size={13} /> {sightingDetails.allObsReported ? "Complete checklist" : "Partial checklist"}</span>
                      ) : null}
                    </div>
                    {sightingDetails.observation?.breedingCode || sightingDetails.observation?.exoticCategory ? (
                      <div className="sighting-detail-tags">
                        {sightingDetails.observation.breedingCode ? <span>Breeding code {sightingDetails.observation.breedingCode}</span> : null}
                        {sightingDetails.observation.exoticCategory ? <span>{sightingDetails.observation.exoticCategory}</span> : null}
                      </div>
                    ) : null}
                    {sightingDetails.observation?.comments ? (
                      <div className="sighting-detail-note species-note">
                        <span>Species note</span>
                        <p>{sightingDetails.observation.comments}</p>
                      </div>
                    ) : null}
                    {sightingDetails.checklistComments ? (
                      <div className="sighting-detail-note">
                        <span>Checklist note</span>
                        <p>{sightingDetails.checklistComments}</p>
                      </div>
                    ) : null}
                    {sightingDetails.observation && totalMedia(sightingDetails.observation.media) > 0 ? (
                      <div className="sighting-detail-media">
                        {sightingDetails.observation.media.photos ? <span><Camera size={13} /> {sightingDetails.observation.media.photos}</span> : null}
                        {sightingDetails.observation.media.audio ? <span><AudioLines size={13} /> {sightingDetails.observation.media.audio}</span> : null}
                        {sightingDetails.observation.media.videos ? <span><Video size={13} /> {sightingDetails.observation.media.videos}</span> : null}
                        <small>Media on eBird</small>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}
            <footer>
              <button type="button" onClick={() => void shareSighting(selectedSighting)}>
                {sightingShareStatus === "Copied" ? <Check size={14} /> : <Share2 size={14} />}
                {sightingShareStatus || "Share"}
              </button>
              <button
                type="button"
                className={watchlist.includes(selectedSighting.properties.speciesCode) ? "active" : ""}
                onClick={() => toggleWatched(selectedSighting.properties.speciesCode)}
              >
                <Star size={14} />
                {watchlist.includes(selectedSighting.properties.speciesCode) ? "Watching" : "My birds"}
              </button>
              {selectedSighting.properties.subId ? (
                <a href={`https://ebird.org/checklist/${selectedSighting.properties.subId}`} target="_blank" rel="noreferrer">
                  Checklist <ExternalLink size={13} />
                </a>
              ) : null}
            </footer>
          </aside>
        ) : null}
      </section>

      <aside className="control-panel" id="species-controls" aria-label="Tracker controls" tabIndex={-1}>
        <header className="brand-row">
          <div className="brand-mark">
            <Bird size={22} />
          </div>
          <div className="brand-text">
            <p className="eyebrow">Live U.S. Sightings</p>
            <h1>Flockline</h1>
            <p className="brand-tag">Live bird movement, charted from eBird checklists.</p>
          </div>
          <div className="brand-actions">
            <button
              type="button"
              className="brand-action"
              onClick={() => setTheme((current) => current === "field" ? "dusk" : "field")}
              aria-pressed={theme === "dusk"}
              title={theme === "field" ? "Switch to Dusk" : "Switch to Field"}
              aria-label={theme === "field" ? "Switch to Dusk theme" : "Switch to Field theme"}
            >
              {theme === "field" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              type="button"
              className={`brand-action ${shareStatus === "Link copied" ? "success" : ""}`}
              onClick={() => void shareView()}
              title={shareStatus || "Copy a link to this exact view"}
              aria-label={shareStatus || "Share this map view"}
            >
              {shareStatus === "Link copied" ? <Check size={16} /> : <Share2 size={16} />}
            </button>
            <button
              type="button"
              className="brand-action"
              onClick={() => loadSightings({ force: true })}
              disabled={loading}
              title="Refresh sightings (latest from eBird)"
              aria-label="Refresh sightings"
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
            <button
              type="button"
              className="brand-action"
              onClick={openTour}
              title="Take the tour"
              aria-label="Take the tour"
            >
              <Compass size={16} />
            </button>
          </div>
        </header>

        <div className="status-strip">
          <span className={`status-badge ${isLiveSource ? "live" : "demo"}`}>
            {isLiveSource ? <Wifi size={14} /> : <WifiOff size={14} />}
            {sourceLabel}
          </span>
          <span className="status-badge">
            <Clock size={14} />
            {formatShortDateTime(visibleStats.latestObsDt)}
          </span>
          <span className="status-badge catalog">
            <Database size={14} />
            {presets.length} birds
          </span>
          <button
            type="button"
            className={`status-badge insights-trigger ${insightsOpen ? "active" : ""}`}
            onClick={toggleInsights}
            aria-expanded={insightsOpen}
          >
            <Sparkles size={14} />
            Insights
          </button>
          <button
            type="button"
            className={`status-badge chat-trigger ${chatOpen ? "active" : ""}`}
            onClick={toggleChat}
            aria-expanded={chatOpen}
          >
            <MessageCircle size={14} />
            Ask
          </button>
          <button
            type="button"
            className={`status-badge watchlist-trigger ${watchlistOpen ? "active" : ""} ${activeAlertFindings.length ? "has-alert" : ""}`}
            onClick={toggleWatchlist}
            aria-expanded={watchlistOpen}
          >
            {activeAlertFindings.length ? <BellRing size={14} /> : <Star size={14} />}
            My birds {watchlist.length ? `· ${watchlist.length}` : ""}
          </button>
          <a className="status-badge methodology-trigger" href="#methodology">
            <BookOpen size={14} />
            Methodology
          </a>
        </div>

        {selectedSpecies ? (
          <section className={`active-species-card ${BIRD_ART[selectedSpecies.speciesCode] ? "illustrated" : ""}`} aria-label="Selected species">
            {BIRD_ART[selectedSpecies.speciesCode] ? (
              <img src={BIRD_ART[selectedSpecies.speciesCode]} alt="" aria-hidden="true" decoding="async" />
            ) : (
              <span className={`species-hero-fallback group-${normalizeCssToken(selectedSpecies.group)}`} aria-hidden="true">
                <Bird size={46} />
              </span>
            )}
            <div className="species-hero-copy">
              <span>Now viewing · {selectedSpecies.group}</span>
              <strong>{selectedSpecies.comName}</strong>
              <em>{selectedSpecies.sciName}</em>
              <span className="species-hero-live">
                <i /> {loading ? "Scanning…" : `${windowStats.locations.toLocaleString()} recent locations`}
              </span>
            </div>
            <div className="active-species-side">
              <code>{selectedSpecies.speciesCode}</code>
              <button
                type="button"
                className={`species-watch ${watchlist.includes(selectedSpecies.speciesCode) ? "active" : ""}`}
                onClick={() => toggleWatched(selectedSpecies.speciesCode)}
                aria-label={watchlist.includes(selectedSpecies.speciesCode) ? `Remove ${selectedSpecies.comName} from My birds` : `Add ${selectedSpecies.comName} to My birds`}
                title={watchlist.includes(selectedSpecies.speciesCode) ? "Remove from My birds" : "Add to My birds"}
              >
                <Star size={14} />
              </button>
              <button
                type="button"
                className="species-clear"
                onClick={clearSpecies}
                title="Clear selection and browse all birds"
                aria-label="Clear selected species and browse all birds"
              >
                <X size={13} />
                Clear
              </button>
            </div>
          </section>
        ) : (
          <section className="active-species-card browse" aria-label="No species selected">
            <div>
              <span>Browsing</span>
              <strong>All {presets.length} birds</strong>
              <em>Pick a species below to chart where it's moving.</em>
            </div>
            <Feather size={22} />
          </section>
        )}

        {selectedSpecies && underreportedCommon.has(selectedSpecies.speciesCode) ? (
          <p className="common-note">
            <Info size={15} />
            <span>
              {selectedSpecies.comName} is one of the most under-reported birds on eBird. Birders often
              skip logging common species, so the map shows far fewer spots than where they really are.
            </span>
          </p>
        ) : null}

        <section className="control-block">
          <div className="block-title">
            <Search size={16} />
            <span>Species</span>
            <span className="section-no">01</span>
          </div>
          <div className="search-box">
            <input
              ref={searchInputRef}
              value={speciesQuery}
              placeholder={`Search ${presets.length} birds…`}
              onChange={(event) => {
                setSpeciesQuery(event.target.value);
                setSearchFocused(true);
              }}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitSearch();
                }
                if (event.key === "Escape") {
                  setSearchFocused(false);
                }
              }}
              aria-label="Species name or eBird species code"
            />
            {speciesQuery ? (
              <button
                type="button"
                className="search-clear"
                // Keep input focus so the full suggestion list opens after clearing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSpeciesQuery("");
                  setSearchFocused(true);
                  searchInputRef.current?.focus();
                }}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={commitSearch} aria-label="Search species">
              <Search size={17} />
            </button>
            {searchFocused ? (
              <div className="suggestions">
                {suggestions.slice(0, 7).map((species) => (
                  <button type="button" key={species.speciesCode} onMouseDown={() => selectSpecies(species)}>
                    <span>{species.comName}</span>
                    <small>{species.speciesCode}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="field-picks" aria-label="Featured birds">
            <span className="field-picks-label">Track now</span>
            <div>
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
          <div className="library-tabs" role="group" aria-label="Species families">
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
          <div className="species-library-grid" ref={speciesGridRef} role="group" aria-label="Browse species">
            {visibleCatalog.map((species) => {
              const isActive = selectedSpecies?.speciesCode === species.speciesCode;
              return (
                <button
                  type="button"
                  key={species.speciesCode}
                  className={isActive ? "active" : ""}
                  aria-pressed={isActive}
                  // Clicking the already-selected bird clears it (back to browsing all).
                  onClick={() => (isActive ? clearSpecies() : selectSpecies(species))}
                  title={isActive ? "Clear selection and browse all birds" : `${species.comName} (${species.speciesCode})`}
                >
                  <span>{species.comName}</span>
                  <small>{species.speciesCode}</small>
                  {isActive ? (
                    <span className="tile-clear" aria-hidden="true">
                      <X size={12} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {filteredCatalog.length > visibleCatalog.length ? (
            <p className="catalog-more">
              Showing {visibleCatalog.length} of {filteredCatalog.length}. Search above or choose a narrower family.
            </p>
          ) : null}
        </section>

        <section className="control-block">
          <div className="block-title">
            <MapIcon size={16} />
            <span>Region</span>
            {!selectedRegionPreset ? <span className="custom-region-label">Custom</span> : null}
            <span className="region-actions">
              <button type="button" onClick={selectAllRegions} disabled={allRegionsSelected}>
                All in region
              </button>
              <button type="button" onClick={clearRegions} disabled={!selectedRegions.length}>
                Clear
              </button>
            </span>
          </div>
          <div className="region-button-set" role="group" aria-label="U.S. coverage">
            {US_REGION_PRESETS.map((region) => (
              <button
                type="button"
                key={region.id}
                className={`${region.id === "nationwide" ? "nationwide-region-button " : ""}${selectedRegionPreset?.id === region.id ? "active" : ""}`.trim()}
                aria-pressed={selectedRegionPreset?.id === region.id}
                onClick={() => selectRegionPreset(region.id)}
              >
                {region.name}
              </button>
            ))}
          </div>
          <p className="state-grid-label">
            {focusedRegion?.id === "nationwide" ? "All states + D.C." : `${focusedRegion?.name} states`} · {selectedRegions.filter((code) => focusedRegion?.stateCodes.includes(code)).length} selected
          </p>
          <div className="state-grid">
            {visibleRegionStates.map((state) => (
              <button
                type="button"
                key={state.code}
                className={selectedRegions.includes(state.code) ? "active" : ""}
                aria-pressed={selectedRegions.includes(state.code)}
                aria-label={state.name}
                onClick={() => toggleRegion(state.code)}
                title={state.name}
              >
                {state.abbr}
              </button>
            ))}
          </div>
        </section>

        <section className="control-block compact">
          <div className="block-title">
            <SlidersHorizontal size={16} />
            <span>Filters</span>
            <span className="section-no">03</span>
          </div>
          <label className="switch-row">
            <span className="switch-text">
              <span className="switch-label">Provisional</span>
              <span className="switch-sub">Include recent reports not yet reviewed by eBird editors.</span>
            </span>
            <input
              type="checkbox"
              checked={includeProvisional}
              onChange={(event) => setIncludeProvisional(event.target.checked)}
            />
          </label>
          <label className="switch-row">
            <span className="switch-text">
              <span className="switch-label">Hotspots only</span>
              <span className="switch-sub">Show sightings at public eBird hotspots, not personal locations.</span>
            </span>
            <input type="checkbox" checked={hotspotsOnly} onChange={(event) => setHotspotsOnly(event.target.checked)} />
          </label>
        </section>

        {error ? <p className="error-line">{error}</p> : null}

        <footer className="panel-footer">
          <span className="footer-mark">◆</span>
          Source · eBird / Cornell Lab of Ornithology
        </footer>
      </aside>

      {insightsOpen ? (
        <aside className="insights-panel" role="dialog" aria-label="Recent insights">
          <header className="insights-head">
            <div>
              <p className="eyebrow">Field Notes · {insightsScopeLabel}</p>
              <h2>Recent Insights</h2>
            </div>
            <div className="insights-head-actions">
              <button
                type="button"
                className="insights-rerun"
                onClick={() => void loadInsights({ fresh: true })}
                disabled={insightsLoading}
                title="Re-run insights for the current timeline window"
                aria-label="Re-run insights"
              >
                <RefreshCw size={16} className={insightsLoading ? "spin" : ""} />
              </button>
              <button
                type="button"
                className="insights-close"
                onClick={() => setInsightsOpen(false)}
                aria-label="Close insights"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="insights-scope">
            <span className="insights-window">
              <CalendarDays size={13} />
              Past {insights ? insights.back : lookbackDays} {(insights ? insights.back : lookbackDays) === 1 ? "day" : "days"}
            </span>
            {insights && !insightsLoading && insightsStale ? (
              <button
                type="button"
                className="insights-restale"
                onClick={() => void loadInsights()}
                title={`Update insights for ${selectedRegionSummary} and the ${lookbackDays}-day timeline window`}
              >
                <RefreshCw size={12} />
                Scope changed · update
              </button>
            ) : null}
            {insights?.coverage.failedRegions.length ? (
              <span className="insights-window" role="status">
                Partial data · {insights.coverage.failedRegions.length} unavailable
              </span>
            ) : null}
          </div>

          {insightsLoading ? (
            <p className="insights-status">Reading recent checklists…</p>
          ) : insightsError ? (
            <p className="insights-status error">{insightsError}</p>
          ) : insights && insights.findings.length ? (
            <>
              <div className="insights-list">
                {insights.findings.map((finding: Insight, index) => (
                  <article className={`insight-card ${finding.kind}`} key={`${finding.speciesCode ?? "x"}-${index}`}>
                    <span className="insight-icon">{insightIcon(finding.kind)}</span>
                    <div className="insight-body">
                      <h3>{finding.title}</h3>
                      <p>{finding.detail}</p>
                      <div className="insight-meta">
                        {finding.region ? (
                          <span className="insight-place">
                            <MapPin size={12} />
                            {finding.region}
                          </span>
                        ) : null}
                        {finding.subId ? (
                          <a href={`https://ebird.org/checklist/${finding.subId}`} target="_blank" rel="noreferrer">
                            Checklist
                            <ExternalLink size={12} />
                          </a>
                        ) : null}
                      </div>
                      {finding.speciesCode ? (
                        <button
                          type="button"
                          className="insight-map"
                          onClick={() => {
                            // Zoom to the finding's reported spot (like the chat's
                            // show_on_map), so the map flies to the bird instead of
                            // doing a broad fit that's easy to miss behind the drawer.
                            const hasFocus =
                              typeof finding.lat === "number" && typeof finding.lng === "number";
                            const sameSpecies = selectedSpecies?.speciesCode === finding.speciesCode;
                            if (hasFocus) {
                              pendingFocusRef.current = { lat: finding.lat as number, lng: finding.lng as number };
                            }
                            selectSpecies({
                              speciesCode: finding.speciesCode as string,
                              comName: finding.comName || (finding.speciesCode as string),
                              sciName: "",
                              group: "Species"
                            });
                            // Already the active species → no reload fires the fit
                            // effect, so move the map now (instant, per the Leaflet
                            // animate gotcha).
                            if (sameSpecies && hasFocus && mapRef.current) {
                              pendingFocusRef.current = null;
                              mapRef.current.setView(
                                [finding.lat as number, finding.lng as number],
                                11,
                                { animate: false }
                              );
                            }
                            if (!isWide) {
                              setInsightsOpen(false);
                            }
                          }}
                        >
                          View on map
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
              <footer className="insights-foot">
                {insights.generator === "llm" ? "Written by Claude" : "From eBird notable sightings"} · updated{" "}
                {formatShortDateTime(insights.generatedAt)}
              </footer>
            </>
          ) : (
            <p className="insights-status">
              No notable sightings in {insightsScopeLabel} during this window.
            </p>
          )}
        </aside>
      ) : null}

      {chatOpen ? (
        <aside className="chat-panel" role="dialog" aria-label="Ask Flockline">
          <header className="chat-head">
            <div className="chat-head-id">
              <span className="chat-avatar">
                <Bird size={18} />
              </span>
              <div>
                <p className="eyebrow">Flockline Assistant</p>
                <h2>Ask about birds</h2>
              </div>
            </div>
            <button
              type="button"
              className="insights-close"
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </header>

          <div className="chat-scroll" ref={chatScrollRef}>
            {chatMessages.length === 0 ? (
              <div className="chat-intro">
                <p>
                  Ask about recent sightings, rare birds, or what's active near you. Answers come live from eBird
                  checklists across {selectedRegionSummary}.
                </p>
              </div>
            ) : (
              chatMessages.map((message, index) => (
                <div className={`chat-msg ${message.role}`} key={index}>
                  {message.role === "assistant" ? (
                    <span className="chat-msg-avatar">
                      <Bird size={14} />
                    </span>
                  ) : null}
                  <div className="chat-bubble">
                    {renderChatText(message.content)}
                    {message.role === "assistant" && message.speciesRefs && message.speciesRefs.length ? (
                      <div className="chat-refs">
                        {message.speciesRefs.map((ref) => (
                          <button
                            type="button"
                            key={ref.speciesCode}
                            className="chat-ref"
                            onClick={() => viewSpeciesFromChat(ref)}
                          >
                            <MapPin size={12} />
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
                <span className="chat-msg-avatar">
                  <Bird size={14} />
                </span>
                <div className="chat-bubble chat-typing" aria-label="Assistant is checking eBird">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}

            {chatError ? <p className="chat-error">{chatError}</p> : null}
          </div>

          {chatMessages.length === 0 && chatSuggestions.length ? (
            <div className="chat-suggestions">
              {chatSuggestions.map((prompt) => (
                <button type="button" key={prompt} className="chat-suggestion" onClick={() => void sendChat(prompt)}>
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
              placeholder="Ask about birds in the area…"
              aria-label="Ask the Flockline assistant"
            />
            <button type="submit" className="chat-send" disabled={chatLoading || !chatInput.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </aside>
      ) : null}

      {watchlistOpen ? (
        <aside className="watchlist-panel" role="dialog" aria-label="My birds">
          <header className="watchlist-head">
            <div>
              <p className="eyebrow">Personal field board</p>
              <h2>My birds</h2>
            </div>
            <button type="button" className="insights-close" onClick={() => setWatchlistOpen(false)} aria-label="Close My birds">
              <X size={18} />
            </button>
          </header>

          {activeAlertFindings.length ? (
            <div className="watch-alert" role="status">
              <BellRing size={17} />
              <span>
                <strong>{activeAlertFindings.length} field {activeAlertFindings.length === 1 ? "alert" : "alerts"}</strong>
                <small>{activeAlertFindings.map((finding) => finding.comName || finding.title).join(" · ")}</small>
              </span>
            </div>
          ) : null}

          {watchlistSpecies.length ? (
            <div className="watchlist-grid">
              {watchlistSpecies.map((species) => {
                const finding = insights?.findings.find((item) => item.speciesCode === species.speciesCode);
                const alertOn = alerts.includes(species.speciesCode);
                return (
                  <article className={`watch-bird-card ${finding ? "notable" : ""}`} key={species.speciesCode}>
                    {BIRD_ART[species.speciesCode] ? <img src={BIRD_ART[species.speciesCode]} alt="" loading="lazy" decoding="async" /> : <span><Bird size={22} /></span>}
                    <button
                      type="button"
                      className="watch-bird-select"
                      onClick={() => {
                        selectSpecies(species);
                        if (!isWide) setWatchlistOpen(false);
                      }}
                    >
                      <strong>{species.comName}</strong>
                      <small>{finding ? finding.title : species.group}</small>
                    </button>
                    <button
                      type="button"
                      className={`watch-bird-alert ${alertOn ? "active" : ""}`}
                      onClick={() => toggleAlert(species.speciesCode)}
                      aria-label={alertOn ? `Turn off field alerts for ${species.comName}` : `Turn on field alerts for ${species.comName}`}
                      title={alertOn ? "Field alerts on" : "Turn on field alerts"}
                    >
                      {alertOn ? <BellRing size={15} /> : <Bell size={15} />}
                    </button>
                    <button
                      type="button"
                      className="watch-bird-remove"
                      onClick={() => toggleWatched(species.speciesCode)}
                      aria-label={`Remove ${species.comName} from My birds`}
                    >
                      <X size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="watchlist-empty">
              <Star size={27} />
              <h3>Build your field board</h3>
              <p>Star a bird from its hero card or any sighting. Flockline will remember it here.</p>
              <div>
                {featuredSpecies.slice(0, 3).map((species) => (
                  <button type="button" key={species.speciesCode} onClick={() => toggleWatched(species.speciesCode)}>
                    + {species.comName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <footer className="watchlist-foot">
            <Bell size={14} />
            Field alerts surface notable eBird reports inside Flockline. Your states and filters are saved on this device.
          </footer>
        </aside>
      ) : null}

      {selectedSpecies ? (
        <section className="metric-rail" aria-label="Sightings summary">
          <div title="Locations plotted right now (the dots on the map)">
            <strong>{visibleStats.sightings.toLocaleString()}</strong>
            <span>On map</span>
          </div>
          <div title={`Locations reported across the whole ${lookbackDays}-day window`}>
            <strong>{windowStats.locations.toLocaleString()}</strong>
            <span>In window</span>
          </div>
          <div title="Total individual birds reported across the window">
            <strong>{windowStats.birds.toLocaleString()}</strong>
            <span>Birds</span>
          </div>
          <div>
            <strong>{selectedRegionLabels.length}</strong>
            <span>States</span>
          </div>
        </section>
      ) : null}

      {selectedSpecies ? (
      <section className="timeline-dock" aria-label="Timeline controls">
        <div className="timeline-summary">
          <span className="species-chip">
            <ShieldCheck size={15} />
            {selectedSpecies.comName}
          </span>
          <span className="date-chip">
            <CalendarDays size={15} />
            {timelineMode === "daily" ? formatDateKey(selectedDateKey) : `${formatDateKey(earliestDateKey)} - ${formatDateKey(selectedDateKey)}`}
          </span>
          <span className="region-chip">
            <MapPin size={15} />
            {selectedRegionSummary}
          </span>
        </div>

        <div className="timeline-controls">
          <button
            type="button"
            className="play-button"
            onClick={() => (playing ? setPlaying(false) : startPlayback())}
            aria-label={playing ? "Pause timeline" : "Play timeline"}
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <div className="range-stack">
            <div className="range-labels">
              <span>Window</span>
              <strong>{lookbackDays}d</strong>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              value={lookbackDays}
              onChange={(event) => setLookbackDays(Number(event.target.value))}
              aria-label="Lookback window in days"
            />
          </div>

          <div className="range-stack wide">
            <div className="range-labels">
              <span>Timeline</span>
              <strong>{formatDateKey(selectedDateKey)}</strong>
            </div>
            <div className="day-histogram" role="group" aria-label="New detections per day">
              {dateKeys.map((key, index) => {
                const count = dailyCounts[index];
                const height = maxDaily ? Math.max(7, Math.round((count / maxDaily) * 100)) : 7;
                const bucket = recencyBucket(index, dateKeys.length);
                const position =
                  index === selectedDayIndex ? "current" : index < selectedDayIndex ? "past" : "future";
                return (
                  <button
                    type="button"
                    key={key}
                    className={`day-bar ${bucket} ${position}`}
                    style={{ height: `${height}%` }}
                    onClick={() => {
                      setPlaying(false);
                      setSelectedDayIndex(index);
                    }}
                    aria-label={`${formatDateKey(key)}: ${count.toLocaleString()} new ${count === 1 ? "location" : "locations"}`}
                    title={`${formatDateKey(key)} · ${count.toLocaleString()} new`}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, lookbackDays - 1)}
              value={selectedDayIndex}
              onChange={(event) => {
                setPlaying(false);
                setSelectedDayIndex(Number(event.target.value));
              }}
              aria-label="Timeline day"
            />
          </div>

          <div className="segmented" role="group" aria-label="Timeline mode">
            <button
              type="button"
              className={timelineMode === "daily" ? "active" : ""}
              aria-pressed={timelineMode === "daily"}
              onClick={() => setTimelineMode("daily")}
            >
              New
              <span className="seg-tip" role="tooltip">
                Only locations whose most recent report is the selected day. A spot seen all week appears
                once, on its newest date.
              </span>
            </button>
            <button
              type="button"
              className={timelineMode === "cumulative" ? "active" : ""}
              aria-pressed={timelineMode === "cumulative"}
              onClick={() => setTimelineMode("cumulative")}
            >
              Trail
              <span className="seg-tip" role="tooltip">
                Every location reported through the selected day, colored by how recent each report is.
                The full picture.
              </span>
            </button>
          </div>

          <div className="legend" title="Marker color shows how recent each sighting is">
            <Layers size={14} />
            <span className="dot old" />
            <span className="dot mid" />
            <span className="dot new" />
            <span className="legend-caption">older → fresh</span>
          </div>
        </div>

        <p className="mode-note">
          {timelineMode === "cumulative" ? (
            <>
              <strong>{visibleStats.sightings.toLocaleString()}</strong> locations · all reports through{" "}
              {formatDateKey(selectedDateKey)}
              <span className="mode-note-dim"> · eBird gives the most recent report per location</span>
            </>
          ) : (
            <>
              <strong>{visibleStats.sightings.toLocaleString()}</strong> locations newly reported on{" "}
              {formatDateKey(selectedDateKey)}
              {" · "}
              <button type="button" className="link-button" onClick={() => setTimelineMode("cumulative")}>
                see all {allFeatures.length.toLocaleString()} in the {lookbackDays}d window
              </button>
            </>
          )}
        </p>
      </section>
      ) : null}

      <Tour open={tourOpen} steps={TOUR_STEPS} onClose={closeTour} />
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

function normalizeCssToken(value: string) {
  return normalizeSpecies(value) || "other";
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
