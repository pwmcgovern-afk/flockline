#!/usr/bin/env python3
"""Review candidate taxonomy/effort coverage before computing EBD frequencies."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile

try:
    from .ebd_inputs import CATEGORIES, InputError, audit_inputs, source_rows
except ImportError:  # Direct CLI use, without installing a Python package.
    from ebd_inputs import CATEGORIES, InputError, audit_inputs, source_rows


METHOD = "flockline-ebd-candidate-cohort-v1"
EXCLUDED_TAXA = {"domestic", "spuh", "slash", "hybrid"}
LOWER_TAXA = {"issf", "intergrade", "form"}
EFFORT_POLICY = {
    "observationTypes": ["Stationary", "Traveling"],
    "maxDurationMinutes": 360, "maxDistanceKm": 10,
    "maxSpeedKmPerHour": 100, "maxObservers": 10,
    "sourceUrl": "https://ebird.github.io/ebird-best-practices/ebird.html#accounting-for-variation-in-effort",
    "status": "Candidate filters based on Cornell's modeling example; not calibrated rarity thresholds.",
}


def load_taxonomy(path, version, expected_sha256):
    if not re.fullmatch(r"\d{4}", str(version)) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise InputError("Pin a four-digit taxonomy version and original SHA-256.")
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        raise InputError("Taxonomy file does not match its pinned SHA-256.")
    try:
        taxa = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise InputError("Taxonomy must be official eBird API JSON.") from error
    if not isinstance(taxa, list) or not taxa:
        raise InputError("Taxonomy must be a nonempty array.")
    by_name, species, codes = {}, {}, set()
    for taxon in taxa:
        if not isinstance(taxon, dict) or not all(isinstance(taxon.get(k), str) and taxon[k]
                                                for k in ("sciName", "comName", "category", "speciesCode")):
            raise InputError("Missing taxonomy fields.")
        code = taxon["speciesCode"]
        if not re.fullmatch(r"[a-z0-9]+", code) or code in codes:
            raise InputError("Duplicate or invalid taxonomy code.")
        parent = taxon.get("reportAs")
        if taxon["category"] not in CATEGORIES or (parent is not None and (
                not isinstance(parent, str) or not re.fullmatch(r"[a-z0-9]+", parent))):
            raise InputError("Invalid taxonomy category or parent code.")
        codes.add(code)
        key = (taxon["category"], taxon["sciName"])
        if key in by_name:
            raise InputError("Ambiguous scientific name within a taxonomy category.")
        by_name[key] = taxon
        if taxon["category"] == "species":
            species[code] = taxon
    if not species:
        raise InputError("Taxonomy has no parent species.")
    return {"byName": by_name, "species": species, "version": str(version), "sha256": digest}


def resolve_taxon(row, taxonomy):
    category = row["CATEGORY"]
    if category in EXCLUDED_TAXA:
        return None, f"excluded_{category}"
    if category not in LOWER_TAXA | {"species"}:
        return None, "unresolved_category"
    # EBD parent and reported-subtaxon names must independently agree with the
    # pinned taxonomy. A familiar common name is never a fallback for a mismatch.
    reported_name = row["SCIENTIFIC NAME"] if category == "species" else (
        row["SUBSPECIES SCIENTIFIC NAME"] or row["SCIENTIFIC NAME"])
    taxon = taxonomy["byName"].get((category, reported_name))
    if not taxon:
        return None, "unresolved_taxon"
    parent = taxon if category == "species" else taxonomy["species"].get(taxon.get("reportAs"))
    if not parent:
        return None, "unresolved_parent"
    if row["SCIENTIFIC NAME"] != parent["sciName"]:
        return None, "unresolved_parent_name"
    return parent["speciesCode"], "mapped"


def number(raw):
    # Effort is a small finite measurement. Bound parsing/normalization so a
    # malformed exponent cannot allocate huge strings or overflow arithmetic.
    if len(raw) > 24:
        return None
    try:
        value = Decimal(raw)
        return value if value.is_finite() and (value == 0 or abs(value.adjusted()) <= 12) else None
    except (InvalidOperation, ValueError):
        return None


def effort_values(row):
    duration = number(row["DURATION MINUTES"])
    distance = number(row["EFFORT DISTANCE KM"])
    observers = number(row["NUMBER OBSERVERS"])
    if row["type"] == "Stationary" and not row["EFFORT DISTANCE KM"]:
        distance = Decimal(0)
    return duration, distance, observers


def eligibility(row, counties, start, end):
    county = row["COUNTY CODE"]
    if county not in counties or not start <= row["OBSERVATION DATE"] <= end:
        return "outside_scope"
    if row["COUNTRY CODE"] != "US" or row["STATE CODE"] != county[:5]:
        return "inconsistent_geography"
    if row["ALL SPECIES REPORTED"] != "1":
        return "incomplete"
    if row["type"] not in EFFORT_POLICY["observationTypes"]:
        return "unsupported_protocol"
    duration, distance, observers = effort_values(row)
    if duration is None or duration <= 0 or distance is None or distance < 0 or observers is None \
            or observers < 1 or observers != observers.to_integral_value():
        return "missing_or_invalid_effort"
    if row["type"] == "Stationary" and distance != 0:
        return "stationary_distance_conflict"
    if duration > EFFORT_POLICY["maxDurationMinutes"]:
        return "duration_limit"
    if distance > EFFORT_POLICY["maxDistanceKm"]:
        return "distance_limit"
    if distance * 60 > EFFORT_POLICY["maxSpeedKmPerHour"] * duration:
        return "speed_limit"
    if observers > EFFORT_POLICY["maxObservers"]:
        return "observer_limit"
    return "included"


def shared_signature(row):
    normalized = []
    for value in effort_values(row):
        if value is None:
            normalized.append(None)
        else:
            normalized.append(str(value.normalize()) if value else "0")
    return json.dumps([row["COUNTRY CODE"], row["STATE CODE"], row["COUNTY CODE"],
                       row["OBSERVATION DATE"], row["ALL SPECIES REPORTED"], row["type"], *normalized])


def validate_scope(counties, start, end):
    if not counties or len(counties) != len(set(counties)) or any(
            not re.fullmatch(r"US-[A-Z]{2}-\d{3}", code) for code in counties):
        raise InputError("Supply distinct exact U.S. county codes.")
    try:
        dates = [date.fromisoformat(value) for value in (start, end)]
    except (TypeError, ValueError) as error:
        raise InputError("Use valid ISO scope dates.") from error
    if any(not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) for value in (start, end)) \
            or start > end or dates[1].year >= date.today().year:
        raise InputError("The candidate scope must be ordered and use completed prior years.")


def candidate_cohort(ebd, sampling, taxonomy_path, taxonomy_version, taxonomy_sha256,
                     counties, start, end, provisional=None):
    validate_scope(counties, start, end)
    taxonomy = load_taxonomy(taxonomy_path, taxonomy_version, taxonomy_sha256)
    audit = audit_inputs(ebd, sampling, provisional)
    if audit["inputChecks"] != "passed":
        raise InputError("Source input audit failed; resolve its diagnostics before selecting a cohort.")
    repeated_sources, mappings, exotic_codes, count_kinds = {}, {}, {}, {}
    resolved = set()
    with tempfile.TemporaryDirectory(prefix="flockline-ebd-cohort-") as directory:
        with closing(sqlite3.connect(Path(directory) / "cohort.sqlite")) as db:
            db.execute("PRAGMA cache_size = -8192")
            db.execute("PRAGMA temp_store = FILE")
            db.executescript("""
                CREATE TABLE events (id TEXT PRIMARY KEY, unit TEXT, county TEXT, day TEXT,
                                     signature TEXT, reason TEXT);
            """)
            repeated_sources["sampling"] = {}
            for row in source_rows(sampling, False, repeated_sources["sampling"]):
                identifier = row["SAMPLING EVENT IDENTIFIER"]
                db.execute("INSERT INTO events VALUES (?,?,?,?,?,?)", (
                    identifier, row["GROUP IDENTIFIER"] or identifier, row["COUNTY CODE"],
                    row["OBSERVATION DATE"], shared_signature(row), eligibility(row, counties, start, end)))
            db.execute("CREATE INDEX event_unit ON events(unit)")
            # A group is one candidate unit only when its copies agree on the
            # filtering metadata. Exclude conflicting groups; never choose the
            # most favorable copy or silently concatenate different visits.
            db.executescript("""
                CREATE TABLE units AS SELECT unit, MIN(county) county, MIN(day) day,
                    COUNT(*) copies,
                    CASE WHEN COUNT(DISTINCT signature)>1 THEN 'shared_copy_conflict'
                         ELSE MIN(reason) END reason
                    FROM events GROUP BY unit;
                CREATE UNIQUE INDEX unit_id ON units(unit);
            """)
            selections = dict(db.execute("SELECT reason, COUNT(*) FROM units GROUP BY reason ORDER BY reason"))
            periods = [{"countyCode": county, "year": year, "month": month,
                        "seasonalBin": period, "candidateUnits": count}
                       for county, year, month, period, count in db.execute("""
                           SELECT county, CAST(substr(day,1,4) AS INTEGER), CAST(substr(day,6,2) AS INTEGER),
                               MIN(3,(CAST(substr(day,9,2) AS INTEGER)-1)/7), COUNT(*)
                           FROM units WHERE reason='included' GROUP BY 1,2,3,4 ORDER BY 1,2,3,4
                       """)]
            for role, path in (("accepted", ebd), ("provisional", provisional)):
                if path is None:
                    mappings[role] = exotic_codes[role] = count_kinds[role] = None
                    continue
                counts, exotics, kinds = Counter(), Counter(), Counter()
                repeated_sources[role] = {}
                for row in source_rows(path, True, repeated_sources[role], ("SUBSPECIES SCIENTIFIC NAME", "EXOTIC CODE")):
                    code, status = resolve_taxon(row, taxonomy)
                    counts[status] += 1
                    if code:
                        resolved.add(code)
                    exotic = row["EXOTIC CODE"]
                    if exotic not in {"", "N", "P", "X"}:
                        raise InputError("Unknown exotic-status code.")
                    exotics[exotic or "not_flagged"] += 1
                    count = row["OBSERVATION COUNT"]
                    if count != "X" and not re.fullmatch(r"[0-9]+", count):
                        raise InputError("Observation counts changed after their input audit.")
                    kinds["present_without_count" if count == "X" else "explicit_zero" if int(count) == 0 else "positive_count"] += 1
                    reason = db.execute("SELECT u.reason FROM events e JOIN units u ON e.unit=u.unit WHERE e.id=?",
                                        (row["SAMPLING EVENT IDENTIFIER"],)).fetchone()
                    if reason is None:
                        raise InputError("Sources changed after their input audit.")
                    if reason[0] == "included":
                        counts[f"candidate_unit_{status}"] += 1
                mappings[role], exotic_codes[role], count_kinds[role] = dict(counts), dict(exotics), dict(kinds)
    for role, source in repeated_sources.items():
        if source["sha256"] != audit["sources"][role]["sha256"]:
            raise InputError("A source changed after its input audit; no candidate report was produced.")
    unresolved = sum(value for counts in mappings.values() if counts for key, value in counts.items()
                     if key.startswith("unresolved_"))
    return {
        "methodVersion": METHOD, "publicationReady": False,
        "taxonomyChecks": "failed" if unresolved else "passed",
        "scope": {"countyCodes": sorted(counties), "startDate": start, "endDate": end},
        "taxonomy": {"version": taxonomy["version"], "sha256": taxonomy["sha256"],
                     "sourceUrl": f"https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species,issf,form,intergrade,domestic&locale=en&version={taxonomy['version']}"},
        "inputAudit": audit,
        "selection": {"candidateUnits": selections.get("included", 0),
                      "unitsByDecision": selections, "periods": periods,
                      "effortPolicy": EFFORT_POLICY,
                      "sharedRule": "One unit per exact checklist/group ID; exclude copies with conflicting filtering metadata."},
        "taxonomyCoverage": {"sourceRowsByDecision": mappings, "resolvedSpeciesCount": len(resolved)},
        "sourceExoticFlags": exotic_codes, "sourceCountKinds": count_kinds,
        "limits": ["Taxonomy coverage counts observation rows, not birds or independent detections.",
                   "Domestic and ambiguous higher taxa are excluded from this candidate species mapping, not treated as absent.",
                   "Exotic codes remain separate diagnostics; no natural-origin inference is made.",
                   "These filters select a candidate comparison cohort, not an effort-adjusted model or rarity label.",
                   "No frequency or non-detection is calculated. Confirm query/sensitive-species/provisional coverage and validate methodology before aggregation."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("ebd", "sampling", "taxonomy", "output"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--provisional", type=Path)
    parser.add_argument("--taxonomy-version", required=True)
    parser.add_argument("--taxonomy-sha256", required=True)
    parser.add_argument("--counties", nargs="+", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or args.output.resolve() in {path.resolve() for path in
                (args.ebd, args.sampling, args.provisional, args.taxonomy) if path}:
            raise InputError("Choose a new output path; existing files are never overwritten.")
        report = candidate_cohort(args.ebd, args.sampling, args.taxonomy, args.taxonomy_version,
                                  args.taxonomy_sha256, args.counties, args.start_date, args.end_date, args.provisional)
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(json.dumps({"taxonomyChecks": report["taxonomyChecks"], "publicationReady": False,
                          "candidateUnits": report["selection"]["candidateUnits"], "report": str(args.output)}))
        return 0 if report["taxonomyChecks"] == "passed" else 1
    except (InputError, OSError, UnicodeError, sqlite3.Error) as error:
        parser.exit(1, f"Candidate cohort failed: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
