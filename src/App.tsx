import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Bird,
  CalendarDays,
  Clock,
  Database,
  ExternalLink,
  KeyRound,
  Layers,
  Map as MapIcon,
  MapPin,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Feather,
  TrendingUp,
  X,
  Wifi,
  WifiOff
} from "lucide-react";
import speciesCatalog from "../shared/speciesCatalog.json";
import type {
  ConfigResponse,
  Insight,
  InsightKind,
  InsightsResponse,
  Region,
  SightingFeature,
  SightingsResponse,
  Species
} from "./types";

const defaultStates: Region[] = [
  { code: "US-ME", abbr: "ME", name: "Maine", center: [44.6939, -69.3819] },
  { code: "US-NH", abbr: "NH", name: "New Hampshire", center: [43.6805, -71.5811] },
  { code: "US-VT", abbr: "VT", name: "Vermont", center: [44.0459, -72.7107] },
  { code: "US-MA", abbr: "MA", name: "Massachusetts", center: [42.4072, -71.3824] },
  { code: "US-RI", abbr: "RI", name: "Rhode Island", center: [41.5801, -71.4774] },
  { code: "US-CT", abbr: "CT", name: "Connecticut", center: [41.6032, -73.0877] },
  { code: "US-NY", abbr: "NY", name: "New York", center: [42.9538, -75.5268] },
  { code: "US-NJ", abbr: "NJ", name: "New Jersey", center: [40.0583, -74.4057] },
  { code: "US-PA", abbr: "PA", name: "Pennsylvania", center: [41.2033, -77.1945] }
];

const defaultPresets = speciesCatalog as Species[];
const defaultSpecies = defaultPresets.find((species) => species.speciesCode === "osprey") ?? defaultPresets[0];
// Browse-tab order: most birder-salient groups first, the long tail after.
// Tabs are derived from whatever groups the catalog actually contains.
const groupOrder = [
  "Raptors", "Waterfowl", "Shorebirds", "Coastal", "Waders", "Waterbirds",
  "Warblers", "Sparrows", "Grosbeaks", "Blackbirds", "Flycatchers", "Vireos",
  "Woodpeckers", "Corvids", "Aerial", "Upland", "Owls", "Backyard", "Other"
];

type TimelineMode = "daily" | "cumulative";

export default function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const sightingLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFitKeyRef = useRef("");

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [states, setStates] = useState(defaultStates);
  const [presets, setPresets] = useState(defaultPresets);
  const [selectedRegions, setSelectedRegions] = useState(defaultStates.map((state) => state.code));
  const [selectedSpecies, setSelectedSpecies] = useState<Species>(defaultSpecies);
  const [speciesQuery, setSpeciesQuery] = useState(defaultSpecies.comName);
  const [suggestions, setSuggestions] = useState<Species[]>(defaultPresets);
  const [searchFocused, setSearchFocused] = useState(false);
  const [speciesGroup, setSpeciesGroup] = useState("All");
  const [lookbackDays, setLookbackDays] = useState(7);
  const [selectedDayIndex, setSelectedDayIndex] = useState(6);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("daily");
  const [playing, setPlaying] = useState(false);
  const [includeProvisional, setIncludeProvisional] = useState(true);
  const [hotspotsOnly, setHotspotsOnly] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [payload, setPayload] = useState<SightingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError("");
    try {
      const response = await fetch("/api/insights");
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
  }, []);

  const toggleInsights = () => {
    setInsightsOpen((open) => {
      const next = !open;
      if (next && !insights && !insightsLoading) {
        void loadInsights();
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

  const selectedRegionLabels = useMemo(() => {
    return states.filter((state) => selectedRegions.includes(state.code)).map((state) => state.abbr);
  }, [selectedRegions, states]);
  const selectedRegionSummary = selectedRegionLabels.length > 4 ? `${selectedRegionLabels.length} states` : selectedRegionLabels.join(" ");
  const filteredCatalog = useMemo(() => {
    return speciesGroup === "All" ? presets : presets.filter((species) => species.group === speciesGroup);
  }, [presets, speciesGroup]);
  const libraryGroups = useMemo(() => {
    const present = new Set(presets.map((species) => species.group));
    const ordered = groupOrder.filter((group) => present.has(group));
    const extras = [...present].filter((group) => !groupOrder.includes(group)).sort();
    return ["All", ...ordered, ...extras];
  }, [presets]);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((nextConfig: ConfigResponse) => {
        setConfig(nextConfig);
        setStates(nextConfig.states);
        setPresets(nextConfig.presets);
        setSuggestions(nextConfig.presets);
        setSelectedRegions(nextConfig.states.map((state) => state.code));
      })
      .catch(() => {
        setConfig({ hasApiKey: false, states: defaultStates, presets: defaultPresets, maxBackDays: 30 });
      });
  }, []);

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

  const loadSightings = useCallback(async () => {
    if (!selectedRegions.length) {
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

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/sightings?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Sightings request failed.");
      }
      setPayload(data);
      setSelectedDayIndex(lookbackDays - 1);
      setPlaying(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sightings request failed.");
    } finally {
      setLoading(false);
    }
  }, [hotspotsOnly, includeProvisional, lookbackDays, selectedRegions, selectedSpecies.speciesCode]);

  useEffect(() => {
    const timeout = window.setTimeout(loadSightings, 360);
    return () => window.clearTimeout(timeout);
  }, [loadSightings]);

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
    }).setView([42.55, -73.45], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    mapRef.current = map;
    sightingLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      sightingLayerRef.current = null;
    };
  }, []);

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
      marker.bindPopup(buildPopup(feature), {
        className: "sighting-popup",
        maxWidth: 280
      });
      marker.addTo(layer);
    }
  }, [dateKeys, visibleFeatures]);

  useEffect(() => {
    if (!payload || !mapRef.current || !allFeatures.length) {
      return;
    }
    const fitKey = `${payload.generatedAt}-${payload.species.speciesCode}-${payload.regions.join("|")}`;
    if (lastFitKeyRef.current === fitKey) {
      return;
    }
    lastFitKeyRef.current = fitKey;
    const bounds = L.latLngBounds(
      allFeatures.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number])
    );
    mapRef.current.fitBounds(bounds.pad(0.16), {
      maxZoom: 8,
      animate: true,
      duration: 0.55
    });
  }, [allFeatures, payload]);

  const selectSpecies = (species: Species) => {
    setSelectedSpecies(species);
    setSpeciesQuery(species.comName);
    setSearchFocused(false);
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

  const selectAllRegions = () => setSelectedRegions(states.map((state) => state.code));
  const clearRegions = () => setSelectedRegions([]);
  const allRegionsSelected = selectedRegions.length === states.length;

  const startPlayback = () => {
    if (selectedDayIndex >= lookbackDays - 1) {
      setSelectedDayIndex(0);
    }
    setPlaying(true);
  };

  const saveApiKey = async () => {
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      setApiKeyStatus("Enter a key first.");
      return;
    }

    setApiKeySaving(true);
    setApiKeyStatus("");
    try {
      const response = await fetch("/api/settings/ebird-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Key setup failed.");
      }
      setConfig((current) =>
        current ? { ...current, hasApiKey: true } : { hasApiKey: true, states, presets, maxBackDays: 30 }
      );
      setApiKeyDraft("");
      setApiKeyStatus("Live key active.");
      await loadSightings();
    } catch (setupError) {
      setApiKeyStatus(setupError instanceof Error ? setupError.message : "Key setup failed.");
    } finally {
      setApiKeySaving(false);
    }
  };

  const sourceLabel = payload?.source === "ebird" ? "Live eBird" : "Demo stream";
  const hasApiKey = config?.hasApiKey ?? false;

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="Sightings map">
        <div ref={mapElementRef} className="map-canvas" />
        <div className="map-vignette" />
        {loading ? (
          <div className="loading-pill">
            <Radar size={16} />
            Syncing
          </div>
        ) : null}
      </section>

      <aside className="control-panel" aria-label="Tracker controls">
        <header className="brand-row">
          <div className="brand-mark">
            <Bird size={22} />
          </div>
          <div className="brand-text">
            <p className="eyebrow">Live Northeast Sightings</p>
            <h1>Flockline</h1>
            <p className="brand-tag">Live bird movement, charted from eBird checklists.</p>
          </div>
        </header>

        <div className="status-strip">
          <span className={`status-badge ${payload?.source === "ebird" ? "live" : "demo"}`}>
            {payload?.source === "ebird" ? <Wifi size={14} /> : <WifiOff size={14} />}
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
        </div>

        <section className="active-species-card" aria-label="Selected species">
          <div>
            <span>{selectedSpecies.group}</span>
            <strong>{selectedSpecies.comName}</strong>
            <em>{selectedSpecies.sciName}</em>
          </div>
          <code>{selectedSpecies.speciesCode}</code>
        </section>

        <section className={`api-key-card ${hasApiKey ? "ready" : ""}`}>
          <div className="block-title">
            <KeyRound size={16} />
            <span>eBird Key</span>
          </div>
          {hasApiKey ? (
            <div className="key-ready">
              <Wifi size={15} />
              <span>Live API key active</span>
            </div>
          ) : (
            <>
              <div className="key-input-row">
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void saveApiKey();
                    }
                  }}
                  placeholder="Paste API key"
                  aria-label="eBird API key"
                />
                <button type="button" onClick={saveApiKey} disabled={apiKeySaving}>
                  {apiKeySaving ? "Saving" : "Save"}
                </button>
              </div>
              <a href="https://ebird.org/api/keygen" target="_blank" rel="noreferrer">
                Get key
                <ExternalLink size={13} />
              </a>
            </>
          )}
          {apiKeyStatus ? <p>{apiKeyStatus}</p> : null}
        </section>

        <section className="control-block">
          <div className="block-title">
            <Search size={16} />
            <span>Species</span>
            <span className="section-no">01</span>
          </div>
          <div className="search-box">
            <input
              value={speciesQuery}
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
          <div className="library-tabs">
            {libraryGroups.map((group) => (
              <button
                type="button"
                key={group}
                className={speciesGroup === group ? "active" : ""}
                onClick={() => setSpeciesGroup(group)}
              >
                {group}
              </button>
            ))}
          </div>
          <div className="species-library-grid">
            {filteredCatalog.map((species) => (
              <button
                type="button"
                key={species.speciesCode}
                className={selectedSpecies.speciesCode === species.speciesCode ? "active" : ""}
                onClick={() => selectSpecies(species)}
                title={`${species.comName} (${species.speciesCode})`}
              >
                <span>{species.comName}</span>
                <small>{species.speciesCode}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="control-block">
          <div className="block-title">
            <MapIcon size={16} />
            <span>Region</span>
            <span className="region-actions">
              <button type="button" onClick={selectAllRegions} disabled={allRegionsSelected}>
                Select all
              </button>
              <button type="button" onClick={clearRegions} disabled={!selectedRegions.length}>
                Clear
              </button>
            </span>
          </div>
          <div className="state-grid">
            {states.map((state) => (
              <button
                type="button"
                key={state.code}
                className={selectedRegions.includes(state.code) ? "active" : ""}
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

        <button type="button" className="refresh-button" onClick={loadSightings}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          Refresh
        </button>

        {error ? <p className="error-line">{error}</p> : null}

        <footer className="panel-footer">
          <span className="footer-mark">◆</span>
          Source · eBird / Cornell Lab of Ornithology
        </footer>
      </aside>

      {insightsOpen ? (
        <aside className="insights-panel" aria-label="Recent insights">
          <header className="insights-head">
            <div>
              <p className="eyebrow">Field Notes · New England</p>
              <h2>Recent Insights</h2>
            </div>
            <button
              type="button"
              className="insights-close"
              onClick={() => setInsightsOpen(false)}
              aria-label="Close insights"
            >
              <X size={18} />
            </button>
          </header>

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
                            selectSpecies({
                              speciesCode: finding.speciesCode as string,
                              comName: finding.comName || (finding.speciesCode as string),
                              sciName: "",
                              group: "Species"
                            });
                            setInsightsOpen(false);
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
            <p className="insights-status">No notable sightings in the last two weeks.</p>
          )}
        </aside>
      ) : null}

      <section className="metric-rail" aria-label="Visible sightings summary">
        <div>
          <strong>{visibleStats.sightings.toLocaleString()}</strong>
          <span>Locations</span>
        </div>
        <div>
          <strong>{visibleStats.checklists.toLocaleString()}</strong>
          <span>Checklists</span>
        </div>
        <div>
          <strong>{visibleStats.reviewedRate}%</strong>
          <span>Reviewed</span>
        </div>
        <div>
          <strong>{selectedRegionLabels.length}</strong>
          <span>States</span>
        </div>
      </section>

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

function buildPopup(feature: SightingFeature) {
  const props = feature.properties;
  const count = props.howMany ? `${props.howMany} reported` : "Present";
  const checklist = props.subId
    ? `<a href="https://ebird.org/checklist/${escapeHtml(props.subId)}" target="_blank" rel="noreferrer">Open checklist</a>`
    : "";

  return `
    <div class="popup-body">
      <strong>${escapeHtml(props.comName)}</strong>
      <span>${escapeHtml(count)} · ${escapeHtml(props.obsDt)}</span>
      <p>${escapeHtml(props.locName)}</p>
      <div>${props.obsReviewed ? "Reviewed" : "Provisional"}${props.locationPrivate ? " · Private" : ""}</div>
      ${checklist}
    </div>
  `;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[character];
  });
}
