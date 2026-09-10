import type { RefObject } from "react";
import { ChevronDown, Search, SlidersHorizontal, Star } from "lucide-react";
import DigestSignup from "./DigestSignup";
import { US_REGION_PRESETS } from "../shared/usGeography.js";
import type { Species } from "./types";

type Props = {
  species: Species | null;
  speciesButtonRef: RefObject<HTMLButtonElement | null>;
  regionId: string | null;
  regionLabel: string;
  digestRegionId: string;
  days: number;
  windows: number[];
  status: string;
  source: string;
  saved: boolean;
  filtered: boolean;
  filtersOpen: boolean;
  underreported: boolean;
  onChooseBird: () => void;
  onRegion: (id: string) => void;
  onDays: (days: number) => void;
  onFilters: () => void;
  onSave: () => void;
  onHome: () => void;
};

// Shares map state and actions with the desktop header. Only the arrangement
// differs, so shared links and saved preferences work on either screen size.
export default function MobileMapHeader(props: Props) {
  return (
    <div className="mobile-header">
      <div className="mobile-brand-row">
        <button className="masthead-eyebrow" type="button" onClick={props.onHome} aria-label="Flockline home">
          flockline
        </button>
        <DigestSignup variant="header" defaultRegionId={props.digestRegionId} />
        <button id="map-controls" className="icon-btn menu-pill" type="button" onClick={props.onFilters} aria-label="States and filters" aria-expanded={props.filtersOpen}>
          <SlidersHorizontal />
          {props.filtered ? <span className="mobile-filter-mark" aria-label="Filters active" /> : null}
        </button>
      </div>
      <div className="mobile-bird-row">
        <button className="masthead-title" type="button" ref={props.speciesButtonRef} onClick={props.onChooseBird} aria-haspopup="dialog">
          <Search aria-hidden="true" />
          <span>{props.species?.comName || "Choose a bird"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
        {props.species ? (
          <button className="icon-btn watch-pill" type="button" onClick={props.onSave} aria-pressed={props.saved}
            aria-label={`${props.saved ? "Remove" : "Add"} ${props.species.comName} ${props.saved ? "from" : "to"} My birds`}>
            <Star />
          </button>
        ) : null}
      </div>
      <div className="mobile-map-controls">
        <select aria-label="Map region" value={props.regionId || "custom"} onChange={(event) => props.onRegion(event.target.value)}>
          {US_REGION_PRESETS.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          {!props.regionId ? <option value="custom">{props.regionLabel}</option> : null}
        </select>
        <select className="mobile-lookback" aria-label="Lookback window" value={props.days} onChange={(event) => props.onDays(Number(event.target.value))}>
          {props.windows.map((days) => <option key={days} value={days}>Past {days} {days === 1 ? "day" : "days"}</option>)}
          {!props.windows.includes(props.days) ? <option value={props.days}>Past {props.days} days</option> : null}
        </select>
      </div>
      <p className="masthead-meta"><span>{props.status}</span><span>{props.source}</span></p>
      {props.underreported ? (
        <details className="mobile-data-note">
          <summary>About these reports</summary>
          <p>This common bird is under-reported on eBird. The map shows fewer locations than where it really occurs.</p>
        </details>
      ) : null}
    </div>
  );
}
