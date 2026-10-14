"""Aggregate supplied species evidence without interpreting missing rows as absence."""

from calendar import monthrange
from datetime import date

try:
    from .ebd_inputs import InputError
except ImportError:
    from ebd_inputs import InputError


METHOD = "flockline-ebd-species-evidence-v1"
MAX_REPORT_CELLS = 100_000


def prepare_periods(counties, start, end, species, taxonomy):
    if not species or len(species) != len(set(species)) or any(
            code not in taxonomy["species"] for code in species):
        raise InputError("Evidence requires distinct parent-species codes from the pinned taxonomy.")
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    year, month = first.year, first.month
    periods = []
    while (year, month) <= (last.year, last.month):
        for seasonal_bin, day in enumerate((1, 8, 15, 22)):
            bin_start = date(year, month, day)
            bin_end = date(year, month, day + 6 if day < 22 else monthrange(year, month)[1])
            if bin_end < first or bin_start > last:
                continue
            for county in sorted(counties):
                periods.append({"countyCode": county, "year": year, "month": month,
                                "seasonalBin": seasonal_bin,
                                "startDate": max(first, bin_start).isoformat(),
                                "endDate": min(last, bin_end).isoformat(),
                                "partialSeasonalBin": first > bin_start or last < bin_end})
            if len(periods) * len(species) > MAX_REPORT_CELLS:
                raise InputError("Evidence report exceeds 100,000 species/period cells; use smaller explicit batches.")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return periods


def create_tables(db):
    db.executescript("""
        CREATE TABLE species_evidence (
            unit TEXT, species TEXT, accepted_positive INTEGER, provisional_positive INTEGER,
            accepted_zero INTEGER, provisional_zero INTEGER, PRIMARY KEY(unit,species)
        );
        CREATE TABLE positive_flags (
            unit TEXT, species TEXT, role TEXT, flag TEXT, PRIMARY KEY(unit,species,role,flag)
        );
    """)


def record_row(db, unit, species, role, count, exotic):
    if role not in {"accepted", "provisional"}:
        raise InputError("Unknown species-evidence source role.")
    positive = int(count == "X" or int(count) > 0)
    accepted = role == "accepted"
    values = (unit, species, int(accepted and positive), int(not accepted and positive),
              int(accepted and not positive), int(not accepted and not positive))
    # Presence is a union over supported taxa and shared copies. Do not sum bird
    # counts, pick the largest flock, or let provisional rows promote review state.
    db.execute("""
        INSERT INTO species_evidence VALUES (?,?,?,?,?,?) ON CONFLICT(unit,species) DO UPDATE SET
            accepted_positive=MAX(accepted_positive,excluded.accepted_positive),
            provisional_positive=MAX(provisional_positive,excluded.provisional_positive),
            accepted_zero=MAX(accepted_zero,excluded.accepted_zero),
            provisional_zero=MAX(provisional_zero,excluded.provisional_zero)
    """, values)
    if positive:
        db.execute("INSERT OR IGNORE INTO positive_flags VALUES (?,?,?,?)",
                   (unit, species, role, exotic or "not_flagged"))


def period_key(period):
    return (period["countyCode"], period["year"], period["month"], period["seasonalBin"])


def summarize(db, periods, selected_periods, species, provisional_supplied, taxonomy_resolved):
    result = {
        "methodVersion": METHOD, "status": "supplied_evidence_only" if taxonomy_resolved else "unresolved_taxonomy",
        "speciesCodes": sorted(species), "publicationReady": False,
        "provisionalCoverage": "file_supplied" if provisional_supplied else "unknown",
        "reportingFrequency": None,
        "frequencyUnavailableReason": "Taxonomy is unresolved." if not taxonomy_resolved else
            "Query completeness, provisional/sensitive-species coverage and method validation are not established.",
        "periods": [],
        "limits": ["Counts concern selected checklist/group units, not independent birds or population size.",
                   "An accepted positive means at least one supplied accepted positive-count or X row.",
                   "Accepted and provisional positives can overlap within a unit; neither is silently discarded.",
                   "Explicit zeros remain separate and never establish a live-bird detection.",
                   "Units without supplied positive rows remain unclassified, not non-detections.",
                   "Positive exotic-flag counts can overlap within a unit; unflagged does not establish natural origin.",
                   "Zero candidate units or missing months cannot establish species absence."],
    }
    if not taxonomy_resolved:
        return result

    evidence = {}
    for row in db.execute("""
        SELECT e.species, u.county, CAST(substr(u.day,1,4) AS INTEGER), CAST(substr(u.day,6,2) AS INTEGER),
               MIN(3,(CAST(substr(u.day,9,2) AS INTEGER)-1)/7),
               SUM(e.accepted_positive), SUM(e.provisional_positive),
               SUM(e.accepted_positive AND e.provisional_positive), SUM(e.accepted_zero), SUM(e.provisional_zero),
               SUM((e.accepted_positive OR e.provisional_positive) AND (e.accepted_zero OR e.provisional_zero))
        FROM species_evidence e JOIN units u ON e.unit=u.unit WHERE u.reason='included' GROUP BY 1,2,3,4,5
    """):
        evidence[tuple(row[:5])] = row[5:]
    flags = {}
    for row in db.execute("""
        SELECT f.species, u.county, CAST(substr(u.day,1,4) AS INTEGER), CAST(substr(u.day,6,2) AS INTEGER),
               MIN(3,(CAST(substr(u.day,9,2) AS INTEGER)-1)/7), f.role, f.flag, COUNT(*)
        FROM positive_flags f JOIN units u ON f.unit=u.unit WHERE u.reason='included' GROUP BY 1,2,3,4,5,6,7
    """):
        flags.setdefault(tuple(row[:6]), {})[row[6]] = row[7]
    candidate_counts = {period_key(period): period["candidateUnits"] for period in selected_periods}
    for period in periods:
        key = period_key(period)
        candidates = candidate_counts.get(key, 0)
        records = []
        for code in sorted(species):
            item_key = (code, *key)
            accepted, provisional, both, accepted_zero, provisional_zero, mixed_zero = evidence.get(item_key, (0,) * 6)
            supplied_positive = accepted + provisional - both
            if not 0 <= supplied_positive <= candidates:
                raise InputError("Species evidence does not reconcile with candidate units.")
            records.append({
                "speciesCode": code, "acceptedPositiveUnits": accepted,
                "provisionalPositiveUnits": provisional if provisional_supplied else None,
                "acceptedAndProvisionalPositiveUnits": both if provisional_supplied else None,
                "provisionalOnlyPositiveUnits": provisional - both if provisional_supplied else None,
                "acceptedExplicitZeroUnits": accepted_zero,
                "provisionalExplicitZeroUnits": provisional_zero if provisional_supplied else None,
                "suppliedPositiveUnits": supplied_positive, "suppliedPositiveAndZeroUnits": mixed_zero,
                "unitsWithoutSuppliedPositiveRows": candidates - supplied_positive,
                "positiveExoticFlags": {
                    "accepted": flags.get((*item_key, "accepted"), {}),
                    "provisional": flags.get((*item_key, "provisional"), {}) if provisional_supplied else None,
                },
            })
        result["periods"].append({**period, "candidateUnits": candidates,
                                  "status": "supplied_evidence_only" if candidates else "no_candidate_units",
                                  "species": records})
    return result
