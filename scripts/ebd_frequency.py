#!/usr/bin/env python3
"""Calculate candidate reporting fractions only for documented source coverage."""

import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

try:
    from .ebd_cohort import METHOD as COHORT_METHOD, validate_scope
    from .ebd_evidence import METHOD as EVIDENCE_METHOD, prepare_periods
    from .ebd_inputs import InputError, METHOD as INPUT_METHOD
except ImportError:
    from ebd_cohort import METHOD as COHORT_METHOD, validate_scope
    from ebd_evidence import METHOD as EVIDENCE_METHOD, prepare_periods
    from ebd_inputs import InputError, METHOD as INPUT_METHOD


METHOD = "flockline-ebd-candidate-frequency-v1"
COVERAGE_METHOD = "flockline-ebd-coverage-review-v1"


def require(condition, message):
    if not condition:
        raise InputError(message)


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def count(value):
    require(type(value) is int and 0 <= value <= 10**12, "Expected a bounded, nonnegative whole unit count.")
    return value


def iso_day(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), "Expected an ISO date.")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise InputError("Invalid calendar date.") from error


def read_json(path):
    raw = Path(path).read_bytes()
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise InputError("Expected a JSON document.") from error
    require(isinstance(value, dict), "Expected a JSON object.")
    return value, hashlib.sha256(raw).hexdigest()


def validate_report(report):
    require(report.get("methodVersion") == COHORT_METHOD and report.get("publicationReady") is False,
            "Unsupported cohort report method or publication state.")
    audit, evidence = report["inputAudit"], report["speciesEvidence"]
    require(audit["methodVersion"] == INPUT_METHOD and audit["inputChecks"] == "passed"
            and report["taxonomyChecks"] == "passed", "Input and taxonomy checks must pass.")
    require(evidence["methodVersion"] == EVIDENCE_METHOD and evidence["status"] == "supplied_evidence_only"
            and evidence["publicationReady"] is False and evidence["reportingFrequency"] is None,
            "Unsupported or unresolved species evidence.")
    sources = audit["sources"]
    require(set(sources) in ({"accepted", "sampling"}, {"accepted", "sampling", "provisional"})
            and all(valid_hash(s["sha256"]) for s in sources.values())
            and valid_hash(report["taxonomy"]["sha256"]), "Invalid source provenance.")
    require(isinstance(report["taxonomy"]["version"], str) and re.fullmatch(r"\d{4}", report["taxonomy"]["version"])
            and isinstance(audit["release"], str) and re.fullmatch(r"[A-Z][a-z]{2}-\d{4}", audit["release"]),
            "Invalid source release or taxonomy version.")
    supplied = "provisional" in sources
    require(evidence["provisionalCoverage"] == ("file_supplied" if supplied else "unknown")
            and audit["provisionalCoverage"] == evidence["provisionalCoverage"], "Conflicting provisional coverage.")
    scope = report["scope"]
    validate_scope(scope["countyCodes"], scope["startDate"], scope["endDate"])
    codes = evidence["speciesCodes"]
    require(isinstance(codes, list) and all(isinstance(c, str) and re.fullmatch(r"[a-z0-9]+", c) for c in codes),
            "Invalid requested species codes.")
    expected = prepare_periods(scope["countyCodes"], scope["startDate"], scope["endDate"], codes,
                               {"species": dict.fromkeys(codes)})
    periods = evidence["periods"]
    require(len(periods) == len(expected), "Evidence has missing or additional periods.")
    for period, wanted in zip(periods, expected):
        require(all(period[key] == value for key, value in wanted.items()), "Evidence period scope does not match its declared scope.")
        n = count(period["candidateUnits"])
        require(period["status"] == ("supplied_evidence_only" if n else "no_candidate_units"), "Conflicting period coverage.")
        birds = period["species"]
        require([b["speciesCode"] for b in birds] == sorted(codes), "Evidence species are missing, duplicated or reordered.")
        for bird in birds:
            a, az = count(bird["acceptedPositiveUnits"]), count(bird["acceptedExplicitZeroUnits"])
            keys = ("provisionalPositiveUnits", "provisionalExplicitZeroUnits", "acceptedAndProvisionalPositiveUnits",
                    "provisionalOnlyPositiveUnits")
            if supplied:
                p, pz, both, only = [count(bird[key]) for key in keys]
                require(both <= min(a, p) and only == p - both, "Provisional overlap does not reconcile.")
            else:
                require(all(bird[key] is None for key in keys), "Missing provisional coverage must stay unknown.")
                # Zero here means no supplied provisional rows, not known absence.
                p, pz, both = 0, 0, 0
            union = a + p - both
            require(max(a, az, p, pz, union) <= n and count(bird["suppliedPositiveUnits"]) == union
                    and count(bird["unitsWithoutSuppliedPositiveRows"]) == n - union
                    and count(bird["suppliedPositiveAndZeroUnits"]) <= min(union, az + pz),
                    "Species counts do not reconcile with candidate units.")
    require(sum(p["candidateUnits"] for p in periods) == count(report["selection"]["candidateUnits"]),
            "Period counts do not reconcile with the selected cohort.")
    return supplied


def source_binding(report, report_hash):
    require(valid_hash(report_hash), "Invalid evidence-report hash.")
    return {"evidenceReportSha256": report_hash, "release": report["inputAudit"]["release"],
            "taxonomyVersion": report["taxonomy"]["version"], "taxonomySha256": report["taxonomy"]["sha256"],
            "sources": {role: source["sha256"] for role, source in report["inputAudit"]["sources"].items()}}


def coverage_template(report, report_hash):
    validate_report(report)
    return {"methodVersion": COVERAGE_METHOD, "binding": source_binding(report, report_hash),
            "query": {"status": "unreviewed", "scope": report["scope"], "allSpecies": None,
                      "speciesCodes": [], "includesSupportedSubtaxa": None,
                      "allMatchingSamplingEvents": None, "evidence": None},
            "sensitivityWindows": [],
            "instructions": "Leave unknowns unreviewed. Use original query evidence and release-applicable sensitivity evidence, never inferred coverage. This review does not grant data-use permission or ecological validation."}


def read_review(proof, root, cache):
    require(isinstance(proof, dict) and all(isinstance(proof.get(k), str) and proof[k].strip()
            for k in ("path", "sha256", "sourceUrl", "reviewedBy", "reviewedAt", "statement")),
            "Coverage assertions need an attributed review and preserved supporting evidence.")
    require(valid_hash(proof["sha256"]), "Invalid coverage-evidence hash.")
    require(iso_day(proof["reviewedAt"]) <= date.today(), "Coverage review cannot be dated in the future.")
    url = urlparse(proof["sourceUrl"])
    require(url.scheme == "https" and url.netloc in {"ebird.org", "support.ebird.org", "www.birds.cornell.edu"}
            and not url.username and not url.password and not url.query and not url.fragment,
            "Use a canonical Cornell source URL without credentials or private query parameters.")
    path = (root / proof["path"]).resolve()
    key = (path, proof["sha256"])
    if key not in cache:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        require(digest.hexdigest() == proof["sha256"], "Coverage evidence changed or its hash is incorrect.")
        cache[key] = {"sha256": proof["sha256"], "sourceUrl": proof["sourceUrl"], "reviewedAt": proof["reviewedAt"]}
    return cache[key]


def scope_parts(scope):
    counties = scope["countyCodes"]
    require(isinstance(counties, list) and counties and len(counties) == len(set(counties))
            and all(isinstance(c, str) and re.fullmatch(r"US-[A-Z]{2}-\d{3}", c) for c in counties),
            "Coverage must use distinct exact county codes.")
    first, last = iso_day(scope["startDate"]), iso_day(scope["endDate"])
    require(first <= last, "Coverage dates are reversed.")
    return set(counties), first, last


def review_coverage(coverage, report, report_hash, root):
    require(coverage.get("methodVersion") == COVERAGE_METHOD
            and coverage["binding"] == source_binding(report, report_hash), "Coverage review belongs to different evidence or source bytes.")
    query, cache = coverage["query"], {}
    require(query["status"] in {"unreviewed", "reviewed"}, "Unknown query-review state.")
    query_verified = query["status"] == "reviewed"
    if query_verified:
        require(query["allMatchingSamplingEvents"] is True,
                "Frequency requires all matching sampling events, including checklists without the requested species.")
        if query["allSpecies"] is not True:
            codes = query.get("speciesCodes")
            require(query["allSpecies"] is False and isinstance(codes, list)
                    and all(isinstance(code, str) for code in codes) and len(codes) == len(set(codes))
                    and set(report["speciesEvidence"]["speciesCodes"]) <= set(codes)
                    and query.get("includesSupportedSubtaxa") is True,
                    "The original query must cover every requested species and its supported subtaxa.")
        original_counties, first, last = scope_parts(query["scope"])
        selected_counties, selected_first, selected_last = scope_parts(report["scope"])
        require(selected_counties <= original_counties and first <= selected_first <= selected_last <= last,
                "The original query does not cover the selected scope.")
        read_review(query["evidence"], root, cache)
    windows = defaultdict(list)
    for window in coverage["sensitivityWindows"]:
        counties, first, last = scope_parts(window)
        codes, status = window["speciesCodes"], window["status"]
        require(status in {"not_withheld", "withheld", "unknown"}, "Unknown sensitivity-coverage state.")
        require(isinstance(codes, list) and codes and len(codes) == len(set(codes))
                and set(codes) <= set(report["speciesEvidence"]["speciesCodes"]), "Invalid sensitivity species scope.")
        require(counties <= set(report["scope"]["countyCodes"]), "Sensitivity coverage names an unrequested county.")
        if status != "unknown":
            require(window["appliesToRelease"] == report["inputAudit"]["release"], "Sensitivity evidence must apply to this source release.")
            read_review(window["evidence"], root, cache)
        for county in counties:
            for code in codes:
                windows[(county, code)].append((first, last, status))
    return query_verified, windows, list(cache.values())


def sensitivity_reason(period, windows):
    day, last = iso_day(period["startDate"]), iso_day(period["endDate"])
    uncovered = False
    while day <= last:
        statuses = {status for first, end, status in windows if first <= day <= end}
        if "withheld" in statuses:
            return "sensitive_withholding"
        if statuses != {"not_withheld"}:
            uncovered = True
        day += timedelta(days=1)
    return "sensitivity_coverage_unknown" if uncovered else None


def calculate(report, report_hash, coverage, coverage_hash, root):
    require(valid_hash(coverage_hash), "Invalid coverage-manifest hash.")
    supplied = validate_report(report)
    query_verified, windows, proofs = review_coverage(coverage, report, report_hash, root)
    annual = []
    for period in report["speciesEvidence"]["periods"]:
        for bird in period["species"]:
            reasons = []
            if not query_verified:
                reasons.append("query_unreviewed")
            if not supplied:
                reasons.append("provisional_source_missing")
            elif bird["provisionalOnlyPositiveUnits"] or bird["provisionalExplicitZeroUnits"]:
                # Withhold this cell rather than call unvetted records absent,
                # promote them to accepted, or silently change the denominator.
                reasons.append("unresolved_provisional_records")
            if not period["candidateUnits"]:
                reasons.append("no_candidate_units")
            if period["partialSeasonalBin"]:
                reasons.append("partial_seasonal_bin")
            reason = sensitivity_reason(period, windows[(period["countyCode"], bird["speciesCode"])])
            if reason:
                reasons.append(reason)
            available = not reasons
            # A covered zero-effort period has known zero counts, but no annual
            # percentage. Retain it when pooling; it is not a missing source year.
            counts_known = available or reasons == ["no_candidate_units"]
            annual.append({**{key: period[key] for key in ("countyCode", "year", "month", "seasonalBin", "startDate", "endDate")},
                           "speciesCode": bird["speciesCode"], "status": "available" if available else "unavailable",
                           "reasons": reasons, "acceptedReportingUnits": bird["acceptedPositiveUnits"] if counts_known else None,
                           "candidateUnits": period["candidateUnits"] if counts_known else None,
                           "frequency": bird["acceptedPositiveUnits"] / period["candidateUnits"] if available else None})
    groups = defaultdict(list)
    for item in annual:
        groups[(item["countyCode"], item["speciesCode"], item["month"], item["seasonalBin"])].append(item)
    pooled = []
    for (county, code, month, seasonal_bin), years in sorted(groups.items()):
        counts_known = all(item["candidateUnits"] is not None for item in years)
        a = sum(item["acceptedReportingUnits"] for item in years) if counts_known else None
        n = sum(item["candidateUnits"] for item in years) if counts_known else None
        available = counts_known and n > 0
        pooled.append({"countyCode": county, "speciesCode": code, "month": month, "seasonalBin": seasonal_bin,
                       "years": [item["year"] for item in years], "status": "available" if available else "unavailable",
                       "acceptedReportingUnits": a, "candidateUnits": n, "frequency": a / n if available else None,
                       "unavailableYears": [item["year"] for item in years if item["candidateUnits"] is None],
                       "unsampledYears": [item["year"] for item in years if item["candidateUnits"] == 0]})
    return {"methodVersion": METHOD, "publicationReady": False, "scope": report["scope"],
            "binding": source_binding(report, report_hash), "coverageManifestSha256": coverage_hash,
            "reviewedEvidence": proofs, "annual": annual, "pooled": pooled,
            "unavailableReasons": dict(Counter(reason for item in annual for reason in item["reasons"])),
            "limits": ["Coverage review is an operator assertion backed by preserved evidence; hashes do not verify its meaning.",
                       "Fractions describe accepted species reports among candidate complete checklist groups, not encounter probability or rarity.",
                       "Taxonomic exclusions and all source exotic flags retain the cohort method; unflagged does not establish natural origin.",
                       "Provisional-only positives or any provisional zero withhold the cell; provisional positives already backed by an accepted positive do not add a detection.",
                       "Unverified annual coverage withholds the pooled fraction. Covered zero-effort years remain listed with zero counts and no annual percentage.",
                       "No sample-size, unusual-count or rarity thresholds are calibrated. Ecological validation and approved use still precede publication."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("template", "calculate"))
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--coverage", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        require(not args.output.exists(), "Choose a new output path; existing files are never overwritten.")
        report, digest = read_json(args.evidence)
        if args.action == "template":
            result = coverage_template(report, digest)
        else:
            require(args.coverage is not None, "Supply a preserved coverage-review manifest.")
            coverage, coverage_hash = read_json(args.coverage)
            result = calculate(report, digest, coverage, coverage_hash, args.coverage.resolve().parent)
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(json.dumps({"action": args.action, "publicationReady": False, "report": str(args.output)}))
    except (InputError, OSError, UnicodeError, KeyError, TypeError) as error:
        parser.exit(1, f"Candidate frequency failed: {error}\n")


if __name__ == "__main__":
    main()
