"""Synthetic coverage review and frequency arithmetic. No real review is implied."""

from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.ebd_evidence import prepare_periods
from scripts.ebd_frequency import InputError, calculate, coverage_template


class FrequencyTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.proof = self.root / "synthetic-review.txt"
        self.proof.write_text("Synthetic test fixture only. This is not a real source or coverage review.")
        self.review = {"path": self.proof.name, "sha256": hashlib.sha256(self.proof.read_bytes()).hexdigest(),
                       "sourceUrl": "https://ebird.org/data/download", "reviewedBy": "Synthetic reviewer",
                       "reviewedAt": date.today().isoformat(), "statement": "Synthetic coverage assertion used only in tests."}

    def report(self, start="2025-01-01", end="2025-01-31", supplied=True):
        scope = {"countyCodes": ["US-CT-009"], "startDate": start, "endDate": end}
        periods = prepare_periods(scope["countyCodes"], start, end, ["bird1"], {"species": {"bird1": {}}})
        for period in periods:
            period.update({"candidateUnits": 3, "status": "supplied_evidence_only", "species": [{
                "speciesCode": "bird1", "acceptedPositiveUnits": 1, "acceptedExplicitZeroUnits": 0,
                "provisionalPositiveUnits": 0 if supplied else None, "provisionalExplicitZeroUnits": 0 if supplied else None,
                "acceptedAndProvisionalPositiveUnits": 0 if supplied else None,
                "provisionalOnlyPositiveUnits": 0 if supplied else None,
                "suppliedPositiveUnits": 1, "suppliedPositiveAndZeroUnits": 0, "unitsWithoutSuppliedPositiveRows": 2,
            }]})
        sources = {"accepted": {"sha256": "a" * 64}, "sampling": {"sha256": "b" * 64}}
        if supplied:
            sources["provisional"] = {"sha256": "c" * 64}
        coverage = "file_supplied" if supplied else "unknown"
        return {"methodVersion": "flockline-ebd-candidate-cohort-v1", "publicationReady": False,
                "taxonomyChecks": "passed", "taxonomy": {"version": "2024", "sha256": "d" * 64}, "scope": scope,
                "inputAudit": {"methodVersion": "flockline-ebd-input-audit-v3", "inputChecks": "passed",
                               "release": "Jan-2026", "sources": sources, "provisionalCoverage": coverage},
                "selection": {"candidateUnits": 3 * len(periods)},
                "speciesEvidence": {"methodVersion": "flockline-ebd-species-evidence-v1", "status": "supplied_evidence_only",
                                    "publicationReady": False, "reportingFrequency": None, "provisionalCoverage": coverage,
                                    "speciesCodes": ["bird1"], "periods": periods}}

    def reviewed(self, report):
        coverage = coverage_template(report, "e" * 64)
        coverage["query"].update(status="reviewed", allSpecies=True, allMatchingSamplingEvents=True, evidence=deepcopy(self.review))
        coverage["sensitivityWindows"] = [{**report["scope"], "speciesCodes": ["bird1"], "status": "not_withheld",
                                            "appliesToRelease": "Jan-2026", "evidence": deepcopy(self.review)}]
        return coverage

    def calculate(self, report, coverage=None):
        return calculate(report, "e" * 64, coverage if coverage is not None else self.reviewed(report), "f" * 64, self.root)

    def set_counts(self, report, index, accepted, candidates):
        period = report["speciesEvidence"]["periods"][index]
        period["candidateUnits"] = candidates
        period["status"] = "supplied_evidence_only" if candidates else "no_candidate_units"
        period["species"][0].update(acceptedPositiveUnits=accepted, suppliedPositiveUnits=accepted,
                                    unitsWithoutSuppliedPositiveRows=candidates - accepted)
        report["selection"]["candidateUnits"] = sum(p["candidateUnits"] for p in report["speciesEvidence"]["periods"])

    def test_reviewed_coverage_keeps_exact_numerator_and_denominator(self):
        result = self.calculate(self.report())
        self.assertFalse(result["publicationReady"])
        for cell in result["annual"]:
            self.assertEqual((cell["acceptedReportingUnits"], cell["candidateUnits"], cell["frequency"]), (1, 3, 1 / 3))
            self.assertEqual(cell["status"], "available")
        self.assertEqual(len(result["reviewedEvidence"]), 1)
        self.assertNotIn("Synthetic reviewer", json.dumps(result))
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_template_cannot_self_approve_query_or_sensitivity_coverage(self):
        report = self.report()
        coverage = coverage_template(report, "e" * 64)
        result = self.calculate(report, coverage)
        for cell in result["annual"]:
            self.assertIsNone(cell["frequency"])
            self.assertEqual(set(cell["reasons"]), {"query_unreviewed", "sensitivity_coverage_unknown"})

    def test_missing_provisional_file_stays_unknown_even_after_a_query_review(self):
        result = self.calculate(self.report(supplied=False))
        self.assertTrue(all(c["frequency"] is None and "provisional_source_missing" in c["reasons"] for c in result["annual"]))

    def test_provisional_only_or_zero_records_withhold_the_cell(self):
        for positive in (True, False):
            report = self.report()
            bird = report["speciesEvidence"]["periods"][0]["species"][0]
            if positive:
                bird.update(provisionalPositiveUnits=1, provisionalOnlyPositiveUnits=1,
                            suppliedPositiveUnits=2, unitsWithoutSuppliedPositiveRows=1)
            else:
                bird["provisionalExplicitZeroUnits"] = 1
            result = self.calculate(report)
            self.assertEqual(result["annual"][0]["reasons"], ["unresolved_provisional_records"])
            self.assertIsNone(result["annual"][0]["frequency"])
            self.assertEqual(result["annual"][1]["frequency"], 1 / 3)

    def test_provisional_copy_of_an_accepted_positive_never_adds_a_detection(self):
        report = self.report()
        report["speciesEvidence"]["periods"][0]["species"][0].update(
            provisionalPositiveUnits=1, acceptedAndProvisionalPositiveUnits=1)
        result = self.calculate(report)
        self.assertEqual(result["annual"][0]["frequency"], 1 / 3)

    def test_zero_reporting_and_no_candidate_units_are_different(self):
        report = self.report()
        self.set_counts(report, 0, 0, 3)
        self.set_counts(report, 1, 0, 0)
        result = self.calculate(report)
        self.assertEqual(result["annual"][0]["frequency"], 0)
        self.assertIsNone(result["annual"][1]["frequency"])
        self.assertIn("no_candidate_units", result["annual"][1]["reasons"])

    def test_pooled_frequency_sums_counts_instead_of_averaging_percentages(self):
        report = self.report("2024-01-01", "2025-12-31")
        self.set_counts(report, 0, 1, 2)
        self.set_counts(report, 48, 1, 8)
        result = self.calculate(report)
        pooled = next(p for p in result["pooled"] if p["month"] == 1 and p["seasonalBin"] == 0)
        self.assertEqual((pooled["acceptedReportingUnits"], pooled["candidateUnits"], pooled["frequency"]), (2, 10, 0.2))

    def test_pool_cannot_silently_drop_an_unavailable_year(self):
        report = self.report("2024-01-01", "2025-12-31")
        coverage = self.reviewed(report)
        coverage["sensitivityWindows"][0]["startDate"] = "2025-01-01"
        result = self.calculate(report, coverage)
        pooled = next(p for p in result["pooled"] if p["month"] == 1 and p["seasonalBin"] == 0)
        self.assertIsNone(pooled["frequency"])
        self.assertEqual(pooled["unavailableYears"], [2024])

    def test_covered_zero_effort_year_is_retained_without_an_annual_percentage(self):
        report = self.report("2024-01-01", "2025-12-31")
        self.set_counts(report, 0, 0, 0)
        result = self.calculate(report)
        pooled = next(p for p in result["pooled"] if p["month"] == 1 and p["seasonalBin"] == 0)
        self.assertIsNone(result["annual"][0]["frequency"])
        self.assertEqual(result["annual"][0]["candidateUnits"], 0)
        self.assertEqual((pooled["acceptedReportingUnits"], pooled["candidateUnits"], pooled["frequency"]), (1, 3, 1 / 3))
        self.assertEqual(pooled["years"], [2024, 2025])
        self.assertEqual(pooled["unsampledYears"], [2024])
        self.assertEqual(pooled["unavailableYears"], [])
        self.set_counts(report, 48, 0, 0)
        pooled = next(p for p in self.calculate(report)["pooled"] if p["month"] == 1 and p["seasonalBin"] == 0)
        self.assertIsNone(pooled["frequency"])
        self.assertEqual(pooled["candidateUnits"], 0)
        self.assertEqual(pooled["unsampledYears"], [2024, 2025])

    def test_sensitivity_gaps_and_conflicting_unknowns_stay_unavailable(self):
        report = self.report()
        coverage = self.reviewed(report)
        coverage["sensitivityWindows"][0]["endDate"] = "2025-01-07"
        result = self.calculate(report, coverage)
        self.assertEqual(result["annual"][0]["frequency"], 1 / 3)
        self.assertTrue(all(c["frequency"] is None for c in result["annual"][1:]))
        coverage = self.reviewed(report)
        coverage["sensitivityWindows"].append({**report["scope"], "speciesCodes": ["bird1"], "status": "unknown"})
        self.assertTrue(all(c["frequency"] is None for c in self.calculate(report, coverage)["annual"]))

    def test_one_withheld_day_blocks_only_the_intersecting_bin(self):
        report = self.report()
        coverage = self.reviewed(report)
        coverage["sensitivityWindows"].append({**deepcopy(coverage["sensitivityWindows"][0]),
                                                "startDate": "2025-01-14", "endDate": "2025-01-14", "status": "withheld"})
        annual = self.calculate(report, coverage)["annual"]
        self.assertEqual([c["status"] for c in annual], ["available", "unavailable", "available", "available"])
        self.assertIn("sensitive_withholding", annual[1]["reasons"])

    def test_partial_bins_cannot_masquerade_as_full_seasonal_periods(self):
        result = self.calculate(self.report("2025-01-10", "2025-01-20"))
        self.assertTrue(all(c["frequency"] is None and "partial_seasonal_bin" in c["reasons"] for c in result["annual"]))

    def test_binding_rejects_another_report_taxonomy_release_or_source(self):
        report = self.report()
        for key in ("evidenceReportSha256", "taxonomyVersion", "taxonomySha256", "release", "sources"):
            coverage = self.reviewed(report)
            coverage["binding"][key] = "changed"
            with self.subTest(key=key), self.assertRaisesRegex(InputError, "different evidence"):
                self.calculate(report, coverage)

    def test_original_query_must_cover_the_counties_dates_species_and_sed(self):
        report = self.report()
        for change in ("county", "date", "species", "sampling"):
            coverage = self.reviewed(report)
            if change == "county": coverage["query"]["scope"] = {**report["scope"], "countyCodes": ["US-CT-001"]}
            if change == "date": coverage["query"]["scope"] = {**report["scope"], "startDate": "2025-01-02"}
            if change == "species": coverage["query"]["allSpecies"] = False
            if change == "sampling": coverage["query"]["allMatchingSamplingEvents"] = None
            with self.subTest(change=change), self.assertRaises(InputError):
                self.calculate(report, coverage)

    def test_species_scoped_query_is_valid_only_with_complete_target_and_sed_coverage(self):
        report = self.report()
        coverage = self.reviewed(report)
        coverage["query"].update(allSpecies=False, speciesCodes=["bird1"], includesSupportedSubtaxa=True)
        self.assertEqual(self.calculate(report, coverage)["annual"][0]["frequency"], 1 / 3)
        coverage["query"]["includesSupportedSubtaxa"] = False
        with self.assertRaisesRegex(InputError, "supported subtaxa"):
            self.calculate(report, coverage)

    def test_unverified_changed_or_wrong_release_proof_cannot_approve_coverage(self):
        report = self.report()
        for change in ("missing", "hash", "reviewer", "future", "release", "url"):
            coverage = self.reviewed(report)
            proof = coverage["query"]["evidence"]
            if change == "missing": proof["path"] = "missing.txt"
            if change == "hash": proof["sha256"] = "0" * 64
            if change == "reviewer": proof["reviewedBy"] = ""
            if change == "future": proof["reviewedAt"] = (date.today() + timedelta(days=1)).isoformat()
            if change == "release": coverage["sensitivityWindows"][0]["appliesToRelease"] = "Jan-2025"
            if change == "url": proof["sourceUrl"] = "https://ebird.org/data/download?private=token"
            with self.subTest(change=change), self.assertRaises((InputError, OSError)):
                self.calculate(report, coverage)

    def test_invalid_counts_missing_periods_and_incompatible_methods_fail(self):
        for change in ("count", "bool", "overlap", "missing", "duplicate", "method", "input_method", "unresolved"):
            report = self.report()
            bird = report["speciesEvidence"]["periods"][0]["species"][0]
            if change == "count": bird["acceptedPositiveUnits"] = 4
            if change == "bool": bird["acceptedPositiveUnits"] = True
            if change == "overlap": bird["acceptedAndProvisionalPositiveUnits"] = 1
            if change == "missing": report["speciesEvidence"]["periods"].pop()
            if change == "duplicate": report["speciesEvidence"]["periods"][1] = deepcopy(report["speciesEvidence"]["periods"][0])
            if change == "method": report["speciesEvidence"]["methodVersion"] = "future-version"
            if change == "input_method": report["inputAudit"]["methodVersion"] = "flockline-ebd-input-audit-v2"
            if change == "unresolved": report["taxonomyChecks"] = "failed"
            with self.subTest(change=change), self.assertRaises(InputError):
                coverage_template(report, "e" * 64)

    def test_cli_template_and_calculation_cannot_overwrite_source_files(self):
        evidence = self.root / "evidence.json"
        evidence.write_text(json.dumps(self.report()))
        coverage, output = self.root / "coverage.json", self.root / "fractions.json"
        command = [sys.executable, "scripts/ebd_frequency.py"]
        result = subprocess.run(command + ["template", "--evidence", str(evidence), "--output", str(coverage)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(command + ["calculate", "--evidence", str(evidence), "--coverage", str(coverage), "--output", str(output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(c["frequency"] is None for c in json.loads(output.read_text())["annual"]))
        previous = evidence.read_bytes()
        result = subprocess.run(command + ["template", "--evidence", str(evidence), "--output", str(evidence)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(evidence.read_bytes(), previous)


if __name__ == "__main__":
    unittest.main()
