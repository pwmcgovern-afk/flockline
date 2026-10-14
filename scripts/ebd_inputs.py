#!/usr/bin/env python3
"""Audit a regional EBD/SED download locally. Never publish source records."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile


METHOD = "flockline-ebd-input-audit-v1"
EVENT_FIELDS = (
    "SAMPLING EVENT IDENTIFIER", "COUNTRY CODE", "STATE CODE", "COUNTY CODE",
    "OBSERVATION DATE", "GROUP IDENTIFIER", "ALL SPECIES REPORTED",
    "DURATION MINUTES", "EFFORT DISTANCE KM", "NUMBER OBSERVERS",
)
OBSERVATION_FIELDS = (
    "GLOBAL UNIQUE IDENTIFIER", "CATEGORY", "SCIENTIFIC NAME",
    "OBSERVATION COUNT", "APPROVED", "REVIEWED",
)
CATEGORIES = {"species", "issf", "form", "intergrade", "domestic", "hybrid", "slash", "spuh"}


class InputError(ValueError):
    """A source cannot be interpreted without guessing."""


def source_identity(path, suffix):
    name = Path(path).name
    if not name.endswith(suffix):
        raise InputError(f"Expected a source filename ending in {suffix}.")
    stem = name[:-len(suffix)]
    match = re.fullmatch(r"ebd_.+_rel([A-Z][a-z]{2}-\d{4})", stem)
    if not match or match[1][:3] not in {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}:
        raise InputError("Keep the original eBird subset/release filename.")
    return stem, match[1]


def source_rows(path, observation, source):
    """EBD is unquoted TSV. Do not let free-text quotes change field boundaries."""
    digest = hashlib.sha256()
    source["rows"] = 0
    with Path(path).open("rb") as handle:
        raw = handle.readline()
        digest.update(raw)
        header = raw.decode("utf-8-sig").rstrip("\r\n").split("\t")
        named = [name for name in header if name]
        if len(named) != len(set(named)) or any(not name for name in header[:-1]):
            raise InputError("Duplicate or empty interior source column.")
        required = EVENT_FIELDS + (OBSERVATION_FIELDS if observation else ())
        if set(required) - set(header):
            raise InputError("Required EBD/SED columns are missing.")
        # Metadata v1.16 renamed PROTOCOL TYPE to OBSERVATION TYPE in 2025.
        protocols = [key for key in ("OBSERVATION TYPE", "PROTOCOL TYPE") if key in header]
        if not protocols:
            raise InputError("Missing observation/protocol type column.")
        indices = {key: header.index(key) for key in (*required, *protocols)}
        for line_number, raw in enumerate(handle, 2):
            digest.update(raw)
            values = raw.decode("utf-8").rstrip("\r\n").split("\t")
            if len(values) != len(header) or (not header[-1] and values[-1]):
                raise InputError(f"Malformed TSV column count at line {line_number}.")
            row = {key: values[index] for key, index in indices.items()}
            if len(protocols) == 2 and row[protocols[0]] != row[protocols[1]]:
                raise InputError(f"Conflicting protocol columns at line {line_number}.")
            row["type"] = row[protocols[0]]
            source["rows"] += 1
            yield row
    source["sha256"] = digest.hexdigest()
    source["protocolColumn"] = protocols[0]


def event(row):
    checklist = row["SAMPLING EVENT IDENTIFIER"]
    group = row["GROUP IDENTIFIER"]
    if not re.fullmatch(r"S\d+", checklist) or (group and not re.fullmatch(r"G\d+", group)):
        raise InputError("Invalid checklist/group identifier.")
    day = row["OBSERVATION DATE"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise InputError("Invalid observation date.")
    try:
        date.fromisoformat(day)
    except ValueError as error:
        raise InputError("Invalid observation date.") from error
    if row["ALL SPECIES REPORTED"] not in {"0", "1"}:
        raise InputError("Unknown complete-checklist flag.")
    # Retain only join/filter fields in temporary storage. No observers, notes,
    # coordinates or media are needed to establish whether these files agree.
    signature = json.dumps([row[key] for key in EVENT_FIELDS[1:]] + [row["type"]])
    effort = json.dumps([row[key] for key in EVENT_FIELDS[-3:]])
    return (checklist, group or checklist, row["COUNTRY CODE"], row["STATE CODE"],
            row["COUNTY CODE"], day, int(row["ALL SPECIES REPORTED"]), row["type"], effort, signature)


def audit_inputs(ebd, sampling, provisional=None):
    stem, release = source_identity(ebd, ".txt")
    if source_identity(sampling, "_sampling.txt")[0] != stem:
        raise InputError("EBD and SED subset/release filenames do not match.")
    if provisional and source_identity(provisional, "_provisional.txt")[0] != stem:
        raise InputError("Provisional subset/release filename does not match.")
    paths = [Path(path).resolve() for path in (ebd, sampling, provisional) if path]
    if len(paths) != len(set(paths)):
        raise InputError("Each source must be a different file.")
    sources = {"accepted": {"filename": Path(ebd).name}, "sampling": {"filename": Path(sampling).name}}
    if provisional:
        sources["provisional"] = {"filename": Path(provisional).name}
    errors = Counter()
    categories = Counter()
    count_kinds = Counter()
    with tempfile.TemporaryDirectory(prefix="flockline-ebd-audit-") as directory:
        with closing(sqlite3.connect(Path(directory) / "audit.sqlite")) as db:
            db.execute("PRAGMA cache_size = -8192")
            db.execute("PRAGMA temp_store = FILE")
            db.executescript("""
                CREATE TABLE events (
                    id TEXT PRIMARY KEY, unit TEXT, country TEXT, state TEXT, county TEXT,
                    day TEXT, complete INTEGER, protocol TEXT, effort TEXT, signature TEXT,
                    accepted INTEGER DEFAULT 0, provisional INTEGER DEFAULT 0
                );
                CREATE TABLE observations (id TEXT PRIMARY KEY);
            """)
            for row in source_rows(sampling, False, sources["sampling"]):
                values = event(row)
                try:
                    db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,0,0)", values)
                except sqlite3.IntegrityError:
                    errors["duplicateSamplingIdentifiers"] += 1
            if not sources["sampling"]["rows"]:
                raise InputError("The sampling file is empty.")
            for role, path in (("accepted", ebd), ("provisional", provisional)):
                if not path:
                    continue
                for row in source_rows(path, True, sources[role]):
                    values = event(row)
                    observation_id = row["GLOBAL UNIQUE IDENTIFIER"]
                    if not re.fullmatch(r"URN:CornellLabOfOrnithology:EBIRD:OBS\d+", observation_id):
                        raise InputError("Invalid observation identifier.")
                    try:
                        db.execute("INSERT INTO observations VALUES (?)", (observation_id,))
                    except sqlite3.IntegrityError:
                        errors["duplicateObservationIdentifiers"] += 1
                    match = db.execute("SELECT signature FROM events WHERE id = ?", (values[0],)).fetchone()
                    if match is None:
                        errors["observationsWithoutSamplingEvent"] += 1
                    elif match[0] != values[-1]:
                        errors["observationSamplingMetadataMismatch"] += 1
                    else:
                        # role is from the fixed pair above, never source text.
                        db.execute(f"UPDATE events SET {role}=1 WHERE id=?", (values[0],))
                    approved, reviewed = row["APPROVED"], row["REVIEWED"]
                    if approved not in {"0", "1"} or reviewed not in {"0", "1"}:
                        errors["unknownReviewFlags"] += 1
                    elif role == "accepted" and approved != "1":
                        errors["unacceptedRecordInAcceptedFile"] += 1
                    elif role == "provisional" and (approved != "0" or reviewed != "0"):
                        errors["nonProvisionalRecordInProvisionalFile"] += 1
                    category = row["CATEGORY"]
                    if category not in CATEGORIES or not row["SCIENTIFIC NAME"]:
                        errors["invalidTaxonFields"] += 1
                    else:
                        categories[category] += 1
                    count = row["OBSERVATION COUNT"]
                    if count == "X":
                        count_kinds["presentWithoutCount"] += 1
                    elif re.fullmatch(r"\d+", count):
                        # Zero can document an old nest with no live birds. A row
                        # alone is not evidence of a bird detected on this visit.
                        count_kinds["explicitZero" if int(count) == 0 else "positiveCount"] += 1
                    else:
                        errors["invalidObservationCount"] += 1
            db.execute("CREATE INDEX event_unit ON events(unit)")
            shared = db.execute("""
                SELECT COUNT(*), COALESCE(SUM(n-1),0),
                    COALESCE(SUM(places>1 OR days>1),0),
                    COALESCE(SUM(completeness>1),0),
                    COALESCE(SUM(protocols>1 OR efforts>1),0)
                FROM (SELECT COUNT(*) n, COUNT(DISTINCT country || ':' || state || ':' || county) places,
                    COUNT(DISTINCT day) days, COUNT(DISTINCT complete) completeness,
                    COUNT(DISTINCT protocol) protocols, COUNT(DISTINCT effort) efforts
                    FROM events WHERE unit LIKE 'G%' GROUP BY unit HAVING COUNT(*)>1)
            """).fetchone()
            if shared[2]:
                errors["sharedGroupsWithConflictingPlaceOrDate"] = shared[2]
            totals = db.execute("""
                SELECT COUNT(*), COUNT(DISTINCT unit), SUM(complete),
                    SUM(accepted=0 AND provisional=0), SUM(accepted=0 AND provisional=1),
                    MIN(day), MAX(day), SUM(county='') FROM events
            """).fetchone()
            protocols = dict(db.execute("SELECT protocol, COUNT(*) FROM events GROUP BY protocol ORDER BY protocol"))
            countries = dict(db.execute("SELECT country, COUNT(*) FROM events GROUP BY country ORDER BY country"))
            counties = dict(db.execute("SELECT county, COUNT(*) FROM events GROUP BY county ORDER BY county"))
    gates = ["Confirm source query, geographic/date coverage and approved project scope.",
             "Pin the matching taxonomy and review species rollup and sensitive-species coverage.",
             "Choose and validate effort filters and shared-checklist selection before aggregation."]
    if provisional is None:
        gates.insert(0, "Provisional coverage is unknown. Do not infer non-detections from accepted records alone.")
    if shared[3] or shared[4]:
        gates.append("Shared copies disagree on completeness or effort; resolve before choosing denominators.")
    return {
        "methodVersion": METHOD, "release": release,
        "inputChecks": "failed" if errors else "passed",
        "publicationReady": False, "sources": sources,
        "provisionalCoverage": "file_supplied" if provisional else "unknown",
        "errors": dict(sorted(errors.items())), "reviewRequired": gates,
        "sampling": {
            "checklists": totals[0], "distinctChecklistOrGroupIds": totals[1],
            "completeChecklistsBeforeDeduplication": totals[2],
            "checklistsWithoutObservationRowsInSuppliedFiles": totals[3],
            "checklistsWithOnlyProvisionalRows": totals[4],
            "dateRange": [totals[5], totals[6]], "missingCounty": totals[7],
            "countries": countries, "counties": counties, "observationTypes": protocols,
        },
        "sharedChecklists": {"groupsWithMultipleCopies": shared[0], "additionalCopies": shared[1],
                             "conflictingPlaceOrDate": shared[2], "mixedCompleteness": shared[3],
                             "mixedProtocolOrEffort": shared[4]},
        "observationCategories": dict(sorted(categories.items())), "observationCounts": dict(count_kinds),
        "limits": "Input audit only. No frequency, absence, rarity, population, or causal conclusion is produced.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ebd", required=True, type=Path)
    parser.add_argument("--sampling", required=True, type=Path)
    parser.add_argument("--provisional", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.output.exists() or args.output.resolve() in {
            path.resolve() for path in (args.ebd, args.sampling, args.provisional) if path
        }:
            raise InputError("Choose a new report path; existing files are never overwritten.")
        report = audit_inputs(args.ebd, args.sampling, args.provisional)
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        print(json.dumps({"inputChecks": report["inputChecks"], "publicationReady": False,
                          "provisionalCoverage": report["provisionalCoverage"], "report": str(args.output)}))
        return 1 if report["errors"] else 0
    except (InputError, OSError, UnicodeError, sqlite3.Error) as error:
        parser.exit(1, f"Input audit failed: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
