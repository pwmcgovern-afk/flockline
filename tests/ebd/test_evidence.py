"""Synthetic shared/accepted/provisional evidence, including unknown coverage."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.ebd_cohort import candidate_cohort
from scripts.ebd_inputs import EVENT_FIELDS, OBSERVATION_FIELDS, InputError, audit_inputs


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        stem = "ebd_US-CT-009_202501_202501_smp_relFeb-2025"
        self.ebd = self.root / f"{stem}.txt"
        self.sed = self.root / f"{stem}_sampling.txt"
        self.provisional = self.root / f"{stem}_provisional.txt"
        self.taxonomy = self.root / "taxonomy.json"
        self.taxonomy.write_text(json.dumps([
            {"speciesCode": "bird1", "sciName": "Synthetic bird", "comName": "Bird", "category": "species"},
            {"speciesCode": "bird2", "sciName": "Synthetic other", "comName": "Other bird", "category": "species"},
            {"speciesCode": "child1", "sciName": "Synthetic bird small", "comName": "Child", "category": "issf", "reportAs": "bird1"},
        ]))
        self.sha = hashlib.sha256(self.taxonomy.read_bytes()).hexdigest()

    def event(self, identifier="S1", **changes):
        row = dict(zip(EVENT_FIELDS, (identifier, "US", "US-CT", "US-CT-009", "2025-01-10",
                                      "", "1", "60", "1", "2")))
        row["OBSERVATION TYPE"] = "Traveling"
        row.update(changes)
        return row

    def observation(self, event, identifier, **changes):
        row = {**event, **dict(zip(OBSERVATION_FIELDS, (
            f"URN:CornellLabOfOrnithology:EBIRD:OBS{identifier}", "species", "Synthetic bird", "1", "1", "0"))),
            "SUBSPECIES SCIENTIFIC NAME": "", "EXOTIC CODE": ""}
        row.update(changes)
        return row

    def write(self, events, accepted, provisional=None):
        for path, rows, observation in ((self.sed, events, False), (self.ebd, accepted, True),
                                        (self.provisional, provisional, True)):
            if rows is None:
                continue
            fields = list(EVENT_FIELDS) + ["OBSERVATION TYPE"]
            if observation:
                fields += list(OBSERVATION_FIELDS) + ["SUBSPECIES SCIENTIFIC NAME", "EXOTIC CODE"]
            path.write_text("\t".join(fields) + "\n" + "".join(
                "\t".join(row.get(key, "") for key in fields) + "\n" for row in rows))

    def run_evidence(self, pending=False, **changes):
        args = dict(ebd=self.ebd, sampling=self.sed, taxonomy_path=self.taxonomy,
                    taxonomy_version="2024", taxonomy_sha256=self.sha, counties=["US-CT-009"],
                    start="2025-01-01", end="2025-01-31", provisional=self.provisional if pending else None,
                    evidence_species=["bird1", "bird2"])
        args.update(changes)
        return candidate_cohort(**args)

    def populated_period(self, report):
        return next(p for p in report["speciesEvidence"]["periods"] if p["candidateUnits"])

    def test_shared_taxa_and_counts_union_once_without_erasing_review_state(self):
        first = self.event(**{"GROUP IDENTIFIER": "G1"})
        copy = self.event("S2", **{"GROUP IDENTIFIER": "G1"})
        other, zero, empty, pending = [self.event(f"S{i}") for i in range(3, 7)]
        accepted = [self.observation(first, 1, **{"OBSERVATION COUNT": "3", "EXOTIC CODE": "N"}),
                    self.observation(first, 2, CATEGORY="issf", **{"SUBSPECIES SCIENTIFIC NAME": "Synthetic bird small", "EXOTIC CODE": "N"}),
                    self.observation(copy, 3, **{"OBSERVATION COUNT": "100", "EXOTIC CODE": "X"}),
                    self.observation(other, 4, **{"OBSERVATION COUNT": "X"}),
                    self.observation(zero, 5, **{"OBSERVATION COUNT": "0"}),
                    self.observation(pending, 6, **{"OBSERVATION COUNT": "0"})]
        provisional = [self.observation(copy, 7, APPROVED="0"), self.observation(pending, 8, APPROVED="0"),
                       self.observation(zero, 9, APPROVED="0", **{"OBSERVATION COUNT": "0"})]
        self.write([first, copy, other, zero, empty, pending], accepted, provisional)
        period = self.populated_period(self.run_evidence(pending=True))
        self.assertEqual(period["candidateUnits"], 5)
        bird, unreported = period["species"]
        expected = {"acceptedPositiveUnits": 2, "provisionalPositiveUnits": 2,
                    "acceptedAndProvisionalPositiveUnits": 1, "provisionalOnlyPositiveUnits": 1,
                    "acceptedExplicitZeroUnits": 2, "provisionalExplicitZeroUnits": 1,
                    "suppliedPositiveUnits": 3, "suppliedPositiveAndZeroUnits": 1,
                    "unitsWithoutSuppliedPositiveRows": 2}
        self.assertEqual({key: bird[key] for key in expected}, expected)
        self.assertEqual(bird["positiveExoticFlags"], {"accepted": {"N": 1, "X": 1, "not_flagged": 1},
                                                     "provisional": {"not_flagged": 2}})
        self.assertEqual(unreported["suppliedPositiveUnits"], 0)
        self.assertEqual(unreported["unitsWithoutSuppliedPositiveRows"], 5)

    def test_only_x_is_positive_and_explicit_zero_never_is(self):
        events = [self.event(f"S{i}") for i in range(1, 4)]
        self.write(events, [self.observation(events[0], 1, **{"OBSERVATION COUNT": "0"}),
                            self.observation(events[1], 2, **{"OBSERVATION COUNT": "X"})])
        bird = self.populated_period(self.run_evidence())["species"][0]
        self.assertEqual(bird["acceptedPositiveUnits"], 1)
        self.assertEqual(bird["acceptedExplicitZeroUnits"], 1)
        self.assertEqual(bird["unitsWithoutSuppliedPositiveRows"], 2)

    def test_missing_provisional_never_becomes_known_zero_or_a_frequency(self):
        event = self.event()
        self.write([event], [self.observation(event, 1)], [])
        unknown, supplied = self.run_evidence(), self.run_evidence(pending=True)
        for report in (unknown, supplied):
            self.assertFalse(report["publicationReady"])
            self.assertIsNone(report["speciesEvidence"]["reportingFrequency"])
            self.assertNotIn("nonDetectionUnits", json.dumps(report))
        a = self.populated_period(unknown)["species"][0]
        b = self.populated_period(supplied)["species"][0]
        for key in ("provisionalPositiveUnits", "acceptedAndProvisionalPositiveUnits",
                    "provisionalOnlyPositiveUnits", "provisionalExplicitZeroUnits"):
            self.assertIsNone(a[key])
            self.assertEqual(b[key], 0)
        self.assertIsNone(a["positiveExoticFlags"]["provisional"])
        self.assertEqual(b["positiveExoticFlags"]["provisional"], {})

    def test_provisional_only_record_cannot_promote_to_accepted(self):
        event = self.event()
        self.write([event], [], [self.observation(event, 1, APPROVED="0", **{"OBSERVATION COUNT": "X"})])
        bird = self.populated_period(self.run_evidence(pending=True))["species"][0]
        self.assertEqual(bird["acceptedPositiveUnits"], 0)
        self.assertEqual(bird["provisionalOnlyPositiveUnits"], 1)

    def test_excluded_checklists_and_conflicting_groups_cannot_add_evidence(self):
        events = [self.event(), self.event("S2", **{"ALL SPECIES REPORTED": "0"}),
                  self.event("S3", **{"GROUP IDENTIFIER": "G1"}),
                  self.event("S4", **{"GROUP IDENTIFIER": "G1", "DURATION MINUTES": "90"})]
        self.write(events, [self.observation(event, i + 1) for i, event in enumerate(events[1:])])
        period = self.populated_period(self.run_evidence())
        self.assertEqual(period["candidateUnits"], 1)
        self.assertEqual(period["species"][0]["acceptedPositiveUnits"], 0)

    def test_unshared_visits_stay_distinct_and_species_do_not_bleed(self):
        events = [self.event(), self.event("S2"), self.event("S3")]
        self.write(events, [self.observation(events[0], 1), self.observation(events[1], 2),
                            self.observation(events[2], 3, **{"SCIENTIFIC NAME": "Synthetic other"})])
        period = self.populated_period(self.run_evidence())
        self.assertEqual(period["candidateUnits"], 3)
        self.assertEqual([b["acceptedPositiveUnits"] for b in period["species"]], [2, 1])

    def test_missing_periods_and_counties_remain_explicit_without_absence(self):
        event = self.event(**{"OBSERVATION DATE": "2024-12-31"})
        self.write([event], [self.observation(event, 1)])
        report = self.run_evidence(start="2024-12-01", end="2025-02-28", counties=["US-CT-009", "US-CT-001"])
        periods = report["speciesEvidence"]["periods"]
        self.assertEqual(len(periods), 24)
        populated = [p for p in periods if p["candidateUnits"]]
        self.assertEqual(len(populated), 1)
        self.assertEqual((populated[0]["countyCode"], populated[0]["year"], populated[0]["seasonalBin"]), ("US-CT-009", 2024, 3))
        for period in periods:
            if not period["candidateUnits"]:
                self.assertEqual(period["status"], "no_candidate_units")

    def test_partial_bins_and_leap_day_are_labelled_with_exact_dates(self):
        event = self.event(**{"OBSERVATION DATE": "2024-02-29"})
        self.write([event], [])
        report = self.run_evidence(start="2024-02-26", end="2024-03-03")
        periods = report["speciesEvidence"]["periods"]
        self.assertEqual([(p["startDate"], p["endDate"], p["partialSeasonalBin"]) for p in periods],
                         [("2024-02-26", "2024-02-29", True), ("2024-03-01", "2024-03-03", True)])
        self.assertEqual(periods[0]["candidateUnits"], 1)

    def test_unresolved_taxonomy_withholds_all_species_evidence(self):
        event = self.event()
        self.write([event], [self.observation(event, 1, **{"SCIENTIFIC NAME": "Unmapped"})])
        report = self.run_evidence()
        self.assertEqual(report["taxonomyChecks"], "failed")
        self.assertEqual(report["speciesEvidence"]["status"], "unresolved_taxonomy")
        self.assertEqual(report["speciesEvidence"]["periods"], [])

    def test_ambiguous_or_domestic_rows_do_not_become_parent_species_reports(self):
        event = self.event()
        self.write([event], [self.observation(event, i + 1, CATEGORY=category)
                             for i, category in enumerate(("domestic", "spuh", "slash", "hybrid"))])
        bird = self.populated_period(self.run_evidence())["species"][0]
        self.assertEqual(bird["acceptedPositiveUnits"], 0)
        self.assertEqual(bird["unitsWithoutSuppliedPositiveRows"], 1)

    def test_invalid_requested_species_and_excessive_grid_fail_before_reading_sources(self):
        for codes in ([], ["unknown"], ["child1"], ["bird1", "bird1"]):
            with self.subTest(codes=codes), self.assertRaisesRegex(InputError, "parent-species"):
                self.run_evidence(evidence_species=codes)
        with patch("scripts.ebd_evidence.MAX_REPORT_CELLS", 1), self.assertRaisesRegex(InputError, "smaller explicit batches"):
            self.run_evidence()

    def test_changed_source_cannot_leave_publishable_partial_evidence(self):
        event = self.event()
        self.write([event], [self.observation(event, 1)])
        def mutate(*args):
            report = audit_inputs(*args)
            self.ebd.write_text(self.ebd.read_text().replace("Synthetic bird", "Synthetic other"))
            return report
        with patch("scripts.ebd_cohort.audit_inputs", side_effect=mutate), self.assertRaisesRegex(InputError, "source changed"):
            self.run_evidence()

    def test_cli_evidence_is_opt_in_and_reproducible(self):
        event = self.event()
        self.write([event], [self.observation(event, 1)])
        self.assertNotIn("speciesEvidence", self.run_evidence(evidence_species=None))
        output = self.root / "evidence.json"
        command = [sys.executable, "scripts/ebd_cohort.py", "--ebd", str(self.ebd), "--sampling", str(self.sed),
                   "--taxonomy", str(self.taxonomy), "--taxonomy-version", "2024", "--taxonomy-sha256", self.sha,
                   "--counties", "US-CT-009", "--start-date", "2025-01-01", "--end-date", "2025-01-31",
                   "--evidence-species", "bird1", "bird2", "--output", str(output)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.read_text()), self.run_evidence())


if __name__ == "__main__":
    unittest.main()
