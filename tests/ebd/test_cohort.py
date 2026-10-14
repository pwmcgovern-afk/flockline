"""Synthetic evidence for candidate selection. No source records are redistributed."""

from copy import deepcopy
from datetime import date
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.ebd_cohort import candidate_cohort, eligibility, load_taxonomy, resolve_taxon
from scripts.ebd_inputs import EVENT_FIELDS, OBSERVATION_FIELDS, InputError, audit_inputs


TAXA = [
    {"speciesCode": "bird1", "sciName": "Synthetic bird", "comName": "Test bird", "category": "species"},
    {"speciesCode": "child1", "sciName": "Synthetic bird small", "comName": "Test child",
     "category": "issf", "reportAs": "bird1"},
]


class CohortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        stem = "ebd_US-CT-009_202501_202501_smp_relFeb-2025"
        self.ebd = self.root / f"{stem}.txt"
        self.sed = self.root / f"{stem}_sampling.txt"
        self.provisional = self.root / f"{stem}_provisional.txt"
        self.taxonomy = self.root / "taxonomy.json"
        self.taxonomy.write_text(json.dumps(TAXA))
        self.sha = hashlib.sha256(self.taxonomy.read_bytes()).hexdigest()

    def event(self, identifier="S1", **changes):
        row = dict(zip(EVENT_FIELDS, (identifier, "US", "US-CT", "US-CT-009", "2025-01-10",
                                      "", "1", "60", "1", "2")))
        row["OBSERVATION TYPE"] = "Traveling"
        row.update(changes)
        row["type"] = row["OBSERVATION TYPE"]
        return row

    def observation(self, event=None, identifier=1, **changes):
        row = dict(event or self.event())
        row.update(dict(zip(OBSERVATION_FIELDS, (
            f"URN:CornellLabOfOrnithology:EBIRD:OBS{identifier}", "species", "Synthetic bird", "1", "1", "0"))))
        row.update({"SUBSPECIES SCIENTIFIC NAME": "", "EXOTIC CODE": ""})
        row.update(changes)
        return row

    def write(self, path, rows, observations=False):
        fields = list(EVENT_FIELDS) + ["OBSERVATION TYPE"]
        if observations:
            fields += list(OBSERVATION_FIELDS) + ["SUBSPECIES SCIENTIFIC NAME", "EXOTIC CODE"]
        path.write_text("\t".join(fields) + "\n" + "".join(
            "\t".join(row.get(key, "") for key in fields) + "\n" for row in rows))

    def prepare(self, events=None, observations=None, pending=None):
        self.write(self.sed, events if events is not None else [self.event()])
        self.write(self.ebd, observations if observations is not None else [self.observation()], True)
        if pending is not None:
            self.write(self.provisional, pending, True)

    def run_cohort(self, pending=False, **changes):
        args = dict(ebd=self.ebd, sampling=self.sed, taxonomy_path=self.taxonomy,
                    taxonomy_version="2024", taxonomy_sha256=self.sha,
                    counties=["US-CT-009"], start="2025-01-01", end="2025-12-31",
                    provisional=self.provisional if pending else None)
        args.update(changes)
        return candidate_cohort(**args)

    def test_taxonomy_bytes_are_pinned_and_missing_or_ambiguous_fields_fail(self):
        with self.assertRaisesRegex(InputError, "pinned SHA"):
            load_taxonomy(self.taxonomy, "2024", "0" * 64)
        variants = [[], {}, [TAXA[0], TAXA[0]],
                    [TAXA[0], {**TAXA[0], "speciesCode": "other"}],
                    [{**TAXA[0], "comName": ""}],
                    [TAXA[0], {**TAXA[1], "reportAs": []}],
                    [{**TAXA[0], "category": "mystery"}]]
        for taxa in variants:
            with self.subTest(taxa=taxa):
                self.taxonomy.write_text(json.dumps(taxa))
                digest = hashlib.sha256(self.taxonomy.read_bytes()).hexdigest()
                with self.assertRaises(InputError):
                    load_taxonomy(self.taxonomy, "2024", digest)

    def test_species_and_source_supported_subtaxa_map_to_one_parent(self):
        for category in ("issf", "form", "intergrade"):
            taxa = deepcopy(TAXA)
            taxa[1]["category"] = category
            self.taxonomy.write_text(json.dumps(taxa))
            taxonomy = load_taxonomy(self.taxonomy, "2024", hashlib.sha256(self.taxonomy.read_bytes()).hexdigest())
            self.assertEqual(resolve_taxon(self.observation(), taxonomy), ("bird1", "mapped"))
            row = self.observation(CATEGORY=category, **{"SUBSPECIES SCIENTIFIC NAME": "Synthetic bird small"})
            self.assertEqual(resolve_taxon(row, taxonomy), ("bird1", "mapped"))
            row["SCIENTIFIC NAME"] = "Different parent"
            self.assertEqual(resolve_taxon(row, taxonomy)[1], "unresolved_parent_name")

    def test_unknown_taxa_never_use_fuzzy_or_common_name_matching(self):
        self.prepare(observations=[self.observation(**{"SCIENTIFIC NAME": "Synthetic Bird"})])
        report = self.run_cohort()
        self.assertEqual(report["taxonomyChecks"], "failed")
        self.assertEqual(report["taxonomyCoverage"]["resolvedSpeciesCount"], 0)

    def test_missing_parent_relationship_stays_unresolved(self):
        taxonomy = load_taxonomy(self.taxonomy, "2024", self.sha)
        taxonomy["byName"][("issf", "Synthetic bird small")].pop("reportAs")
        row = self.observation(CATEGORY="issf", **{"SUBSPECIES SCIENTIFIC NAME": "Synthetic bird small"})
        self.assertEqual(resolve_taxon(row, taxonomy), (None, "unresolved_parent"))

    def test_domestic_and_ambiguous_taxa_are_excluded_not_absences(self):
        self.prepare(observations=[self.observation(identifier=i + 1, CATEGORY=category)
                                   for i, category in enumerate(("domestic", "spuh", "slash", "hybrid"))])
        report = self.run_cohort()
        counts = report["taxonomyCoverage"]["sourceRowsByDecision"]["accepted"]
        for category in ("domestic", "spuh", "slash", "hybrid"):
            self.assertEqual(counts[f"excluded_{category}"], 1)
        self.assertEqual(report["taxonomyCoverage"]["resolvedSpeciesCount"], 0)
        self.assertFalse(report["publicationReady"])

    def test_effort_limits_include_boundaries_and_exclude_excess(self):
        def decision(**changes):
            return eligibility(self.event(**changes), {"US-CT-009"}, "2025-01-01", "2025-12-31")
        self.assertEqual(decision(**{"DURATION MINUTES": "360", "EFFORT DISTANCE KM": "10",
                                     "NUMBER OBSERVERS": "10"}), "included")
        self.assertEqual(decision(**{"DURATION MINUTES": "6", "EFFORT DISTANCE KM": "10"}), "included")
        for changes, reason in [({"DURATION MINUTES": "360.1"}, "duration_limit"),
                                ({"EFFORT DISTANCE KM": "10.1"}, "distance_limit"),
                                ({"DURATION MINUTES": "5.9", "EFFORT DISTANCE KM": "10"}, "speed_limit"),
                                ({"NUMBER OBSERVERS": "11"}, "observer_limit")]:
            self.assertEqual(decision(**changes), reason)

    def test_missing_invalid_and_nonfinite_effort_cannot_enter_cohort(self):
        for key in ("DURATION MINUTES", "EFFORT DISTANCE KM", "NUMBER OBSERVERS"):
            for value in ("", "-1", "NaN", "Infinity", "1e999999999", "invalid"):
                with self.subTest(key=key, value=value):
                    self.prepare(events=[self.event(**{key: value})], observations=[])
                    self.assertEqual(self.run_cohort()["selection"]["unitsByDecision"], {"missing_or_invalid_effort": 1})
        for key, value in (("DURATION MINUTES", "0"), ("NUMBER OBSERVERS", "0"), ("NUMBER OBSERVERS", "1.5")):
            self.prepare(events=[self.event(**{key: value})], observations=[])
            self.assertEqual(self.run_cohort()["selection"]["candidateUnits"], 0)

    def test_stationary_blank_distance_means_zero_but_positive_conflicts(self):
        for distance, reason in (("", "included"), ("0", "included"), ("0.01", "stationary_distance_conflict")):
            self.prepare(events=[self.event(**{"OBSERVATION TYPE": "Stationary", "EFFORT DISTANCE KM": distance})], observations=[])
            self.assertEqual(self.run_cohort()["selection"]["unitsByDecision"], {reason: 1})

    def test_scope_completeness_protocol_and_geography_are_explicit(self):
        for changes, reason in [({"ALL SPECIES REPORTED": "0"}, "incomplete"),
                                ({"OBSERVATION TYPE": "Incidental"}, "unsupported_protocol"),
                                ({"STATE CODE": "US-NY"}, "inconsistent_geography"),
                                ({"COUNTY CODE": "US-CT-001"}, "outside_scope"),
                                ({"OBSERVATION DATE": "2024-01-10"}, "outside_scope")]:
            self.prepare(events=[self.event(**changes)], observations=[])
            self.assertEqual(self.run_cohort()["selection"]["unitsByDecision"], {reason: 1})

    def test_scope_must_use_distinct_exact_counties_and_completed_years(self):
        self.prepare()
        for changes in ({"counties": []}, {"counties": ["CT"]}, {"counties": ["US-CT-009"] * 2},
                        {"start": "2025-02-30"}, {"start": "2025-12-31", "end": "2025-01-01"},
                        {"end": f"{date.today().year}-12-31"}):
            with self.subTest(changes=changes), self.assertRaises(InputError):
                self.run_cohort(**changes)

    def test_shared_copies_collapse_but_identical_unshared_visits_do_not(self):
        events = [self.event("S1", **{"GROUP IDENTIFIER": "G1", "EFFORT DISTANCE KM": "0"}),
                  self.event("S2", **{"GROUP IDENTIFIER": "G1", "DURATION MINUTES": "60.0", "EFFORT DISTANCE KM": "-0"}),
                  self.event("S3"), self.event("S4")]
        self.prepare(events, [self.observation(events[0]), self.observation(events[1], 2)])
        report = self.run_cohort()
        self.assertEqual(report["selection"]["candidateUnits"], 3)
        self.assertEqual(report["taxonomyCoverage"]["sourceRowsByDecision"]["accepted"]["candidate_unit_mapped"], 2)

    def test_disagreeing_shared_copies_are_excluded_as_a_whole(self):
        for changes in ({"DURATION MINUTES": "61"}, {"ALL SPECIES REPORTED": "0"},
                        {"OBSERVATION TYPE": "Incidental"}):
            self.prepare(events=[self.event(**{"GROUP IDENTIFIER": "G1"}),
                                 self.event("S2", **{"GROUP IDENTIFIER": "G1", **changes})], observations=[])
            report = self.run_cohort()
            self.assertEqual(report["selection"]["unitsByDecision"], {"shared_copy_conflict": 1})
            self.assertEqual(report["selection"]["candidateUnits"], 0)

    def test_invalid_input_join_blocks_candidate_selection(self):
        self.prepare(observations=[self.observation(self.event("S2"))])
        with self.assertRaisesRegex(InputError, "input audit failed"):
            self.run_cohort()

    def test_place_date_conflicts_exclude_every_copy_without_losing_unrelated_evidence(self):
        for field, value in (("COUNTRY CODE", "CA"), ("STATE CODE", "US-NY"),
                             ("COUNTY CODE", "US-CT-001"), ("OBSERVATION DATE", "2024-12-31")):
            with self.subTest(field=field):
                events = [self.event(**{"GROUP IDENTIFIER": "G1"}),
                          self.event("S2", **{"GROUP IDENTIFIER": "G1", field: value}), self.event("S3")]
                self.prepare(events, [self.observation(event, i + 1) for i, event in enumerate(events)])
                report = self.run_cohort(evidence_species=["bird1"])
                self.assertEqual(report["inputAudit"]["warnings"]["sharedGroupsWithConflictingPlaceOrDate"], 1)
                self.assertEqual(report["selection"]["unitsByDecision"], {"included": 1, "shared_copy_conflict": 1})
                periods = report["speciesEvidence"]["periods"]
                self.assertEqual(sum(p["candidateUnits"] for p in periods), 1)
                self.assertEqual(sum(p["species"][0]["acceptedPositiveUnits"] for p in periods), 1)

    def test_seasonal_bins_and_empty_checklists_are_retained_without_absence_claims(self):
        days = ("01-01", "01-07", "01-08", "01-14", "01-15", "01-21", "01-22", "01-31", "02-28")
        self.prepare(events=[self.event(f"S{i + 1}", **{"OBSERVATION DATE": f"2025-{day}"})
                             for i, day in enumerate(days)], observations=[])
        report = self.run_cohort()
        self.assertEqual(report["selection"]["candidateUnits"], 9)
        self.assertEqual([(p["month"], p["seasonalBin"], p["candidateUnits"]) for p in report["selection"]["periods"]],
                         [(1, 0, 2), (1, 1, 2), (1, 2, 2), (1, 3, 2), (2, 3, 1)])
        self.assertFalse(report["publicationReady"])
        self.assertNotIn("frequency", report)
        self.assertEqual(report["inputAudit"]["provisionalCoverage"], "unknown")

    def test_missing_provisional_is_distinct_from_supplied_empty(self):
        self.prepare(pending=[])
        unknown, empty = self.run_cohort(), self.run_cohort(pending=True)
        for key in ("sourceExoticFlags", "sourceCountKinds"):
            self.assertIsNone(unknown[key]["provisional"])
            self.assertEqual(empty[key]["provisional"], {})
        self.assertIsNone(unknown["taxonomyCoverage"]["sourceRowsByDecision"]["provisional"])
        self.assertEqual(empty["taxonomyCoverage"]["sourceRowsByDecision"]["provisional"], {})

    def test_exotic_flags_review_states_and_count_kinds_remain_separate(self):
        self.prepare(observations=[self.observation(**{"EXOTIC CODE": "P", "OBSERVATION COUNT": "X"}),
                                   self.observation(identifier=2, **{"EXOTIC CODE": "X", "OBSERVATION COUNT": "0"}),
                                   self.observation(identifier=3, **{"EXOTIC CODE": "N"})],
                     pending=[self.observation(identifier=4, APPROVED="0")])
        report = self.run_cohort(pending=True)
        self.assertEqual(report["sourceExoticFlags"], {"accepted": {"P": 1, "X": 1, "N": 1},
                                                      "provisional": {"not_flagged": 1}})
        self.assertEqual(report["sourceCountKinds"]["accepted"], {"present_without_count": 1, "explicit_zero": 1, "positive_count": 1})
        self.assertEqual(report["sourceCountKinds"]["provisional"], {"positive_count": 1})

    def test_unknown_exotic_code_cannot_silently_mean_unflagged(self):
        self.prepare(observations=[self.observation(**{"EXOTIC CODE": "?"})])
        with self.assertRaisesRegex(InputError, "Unknown exotic"):
            self.run_cohort()

    def test_source_changes_between_audit_and_selection_fail_closed(self):
        self.prepare()
        def mutate(*args):
            report = audit_inputs(*args)
            self.ebd.write_text(self.ebd.read_text().replace("Synthetic bird", "Changed bird"))
            return report
        with patch("scripts.ebd_cohort.audit_inputs", side_effect=mutate), self.assertRaisesRegex(InputError, "source changed"):
            self.run_cohort()

    def test_cli_saves_failed_mapping_diagnostics_and_never_overwrites(self):
        self.prepare(observations=[self.observation(**{"SCIENTIFIC NAME": "Unmapped bird"})])
        output = self.root / "cohort.json"
        command = [sys.executable, "scripts/ebd_cohort.py", "--ebd", str(self.ebd), "--sampling", str(self.sed),
                   "--taxonomy", str(self.taxonomy), "--taxonomy-version", "2024", "--taxonomy-sha256", self.sha,
                   "--counties", "US-CT-009", "--start-date", "2025-01-01", "--end-date", "2025-01-31", "--output", str(output)]
        completed = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual(json.loads(output.read_text())["taxonomyChecks"], "failed")
        previous = output.read_bytes()
        completed = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("never overwritten", completed.stderr)
        self.assertEqual(output.read_bytes(), previous)


if __name__ == "__main__":
    unittest.main()
