"""Synthetic records only. No original Cornell records are redistributed."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.ebd_inputs import EVENT_FIELDS, OBSERVATION_FIELDS, InputError, audit_inputs


class InputAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ebd = self.root / "ebd_US-CT-009_202501_202501_smp_relFeb-2025.txt"
        self.sed = self.root / "ebd_US-CT-009_202501_202501_smp_relFeb-2025_sampling.txt"
        self.provisional = self.root / "ebd_US-CT-009_202501_202501_smp_relFeb-2025_provisional.txt"

    def event(self, identifier="S1", **changes):
        record = dict(zip(EVENT_FIELDS, (identifier, "US", "US-CT", "US-CT-009", "2025-01-10",
                                         "", "1", "60", "1", "2")))
        record["OBSERVATION TYPE"] = "Traveling"
        record.update(changes)
        return record

    def observation(self, event=None, identifier=1, **changes):
        record = dict(event or self.event())
        record.update(dict(zip(OBSERVATION_FIELDS, (
            f"URN:CornellLabOfOrnithology:EBIRD:OBS{identifier}", "species", "Synthetic bird",
            "1", "1", "0"))))
        record.update(changes)
        return record

    def write(self, path, rows, observation=False, legacy=False):
        protocol = "PROTOCOL TYPE" if legacy else "OBSERVATION TYPE"
        fields = list(EVENT_FIELDS) + [protocol] + (list(OBSERVATION_FIELDS) if observation else [])
        fields += ["CHECKLIST COMMENTS", ""]
        text = "\t".join(fields) + "\n"
        for row in rows:
            text += "\t".join(row.get("OBSERVATION TYPE", "") if key == "PROTOCOL TYPE"
                              else row.get(key, "") for key in fields) + "\n"
        path.write_text(text, encoding="utf-8")

    def audit(self, events=None, observations=None, pending=None, legacy=False):
        self.write(self.sed, events if events is not None else [self.event()], legacy=legacy)
        self.write(self.ebd, observations if observations is not None else [self.observation()], True, legacy)
        if pending is not None:
            self.write(self.provisional, pending, True, legacy)
        return audit_inputs(self.ebd, self.sed, self.provisional if pending is not None else None)

    def test_sample_only_and_missing_provisional_never_imply_readiness(self):
        report = self.audit()
        self.assertEqual(report["inputChecks"], "passed")
        self.assertFalse(report["publicationReady"])
        self.assertEqual(report["provisionalCoverage"], "unknown")
        self.assertIn("Do not infer non-detections", report["reviewRequired"][0])
        self.assertEqual(report["sources"]["accepted"]["sha256"], hashlib.sha256(self.ebd.read_bytes()).hexdigest())

    def test_legacy_and_current_columns_have_identical_event_results(self):
        current = self.audit()
        legacy = self.audit(legacy=True)
        self.assertEqual(current["sampling"], legacy["sampling"])
        self.assertEqual(legacy["sources"]["sampling"]["protocolColumn"], "PROTOCOL TYPE")

    def test_empty_provisional_file_is_supplied_not_inferred(self):
        report = self.audit(pending=[])
        self.assertEqual(report["provisionalCoverage"], "file_supplied")
        self.assertEqual(report["sources"]["provisional"]["rows"], 0)
        self.assertFalse(report["publicationReady"])

    def test_complete_checklist_with_no_observations_is_retained(self):
        report = self.audit(events=[self.event(), self.event("S2")], pending=[])
        self.assertEqual(report["sampling"]["checklists"], 2)
        self.assertEqual(report["sampling"]["checklistsWithoutObservationRowsInSuppliedFiles"], 1)

    def test_provisional_only_report_is_not_an_empty_checklist(self):
        second = self.event("S2")
        pending = self.observation(second, 2, APPROVED="0")
        report = self.audit(events=[self.event(), second], pending=[pending])
        self.assertEqual(report["sampling"]["checklistsWithOnlyProvisionalRows"], 1)
        self.assertEqual(report["sampling"]["checklistsWithoutObservationRowsInSuppliedFiles"], 0)

    def test_shared_copies_count_once_but_repeated_unshared_visits_stay_distinct(self):
        events = [self.event("S1", **{"GROUP IDENTIFIER": "G1"}),
                  self.event("S2", **{"GROUP IDENTIFIER": "G1"}), self.event("S3")]
        report = self.audit(events=events, observations=[self.observation(events[0])])
        self.assertEqual(report["sampling"]["distinctChecklistOrGroupIds"], 2)
        self.assertEqual(report["sharedChecklists"]["additionalCopies"], 1)

    def test_shared_place_or_date_conflict_fails(self):
        for field, value in (("COUNTY CODE", "US-CT-001"), ("OBSERVATION DATE", "2025-01-11")):
            with self.subTest(field=field):
                events = [self.event(**{"GROUP IDENTIFIER": "G1"}),
                          self.event("S2", **{"GROUP IDENTIFIER": "G1", field: value})]
                report = self.audit(events, [])
                self.assertEqual(report["errors"]["sharedGroupsWithConflictingPlaceOrDate"], 1)
                self.assertEqual(report["inputChecks"], "failed")

    def test_shared_completeness_and_effort_disagreement_is_exposed(self):
        report = self.audit(events=[self.event(**{"GROUP IDENTIFIER": "G1"}),
                                   self.event("S2", **{"GROUP IDENTIFIER": "G1", "ALL SPECIES REPORTED": "0",
                                                       "DURATION MINUTES": "90"})], observations=[])
        self.assertEqual(report["sharedChecklists"]["mixedCompleteness"], 1)
        self.assertEqual(report["sharedChecklists"]["mixedProtocolOrEffort"], 1)
        self.assertIn("Shared copies disagree", report["reviewRequired"][-1])

    def test_join_failure_and_changed_metadata_fail(self):
        report = self.audit(observations=[self.observation(self.event("S2")),
                                          self.observation(identifier=2, **{"DURATION MINUTES": "61"})])
        self.assertEqual(report["errors"]["observationsWithoutSamplingEvent"], 1)
        self.assertEqual(report["errors"]["observationSamplingMetadataMismatch"], 1)

    def test_duplicate_events_and_observations_fail(self):
        report = self.audit(events=[self.event(), self.event()],
                            observations=[self.observation(), self.observation()])
        self.assertEqual(report["errors"]["duplicateSamplingIdentifiers"], 1)
        self.assertEqual(report["errors"]["duplicateObservationIdentifiers"], 1)

    def test_duplicate_observation_across_accepted_and_provisional_fails(self):
        report = self.audit(pending=[self.observation(APPROVED="0")])
        self.assertEqual(report["errors"]["duplicateObservationIdentifiers"], 1)

    def test_review_flags_cannot_swap_evidence_classes(self):
        report = self.audit(observations=[self.observation(APPROVED="0")],
                            pending=[self.observation(identifier=2, APPROVED="0", REVIEWED="1")])
        self.assertEqual(report["errors"]["unacceptedRecordInAcceptedFile"], 1)
        self.assertEqual(report["errors"]["nonProvisionalRecordInProvisionalFile"], 1)

    def test_explicit_zero_and_x_counts_are_not_treated_as_positive_counts(self):
        report = self.audit(observations=[self.observation(**{"OBSERVATION COUNT": "0"}),
                                          self.observation(identifier=2, **{"OBSERVATION COUNT": "X"})])
        self.assertEqual(report["observationCounts"], {"explicitZero": 1, "presentWithoutCount": 1})

    def test_unknown_flags_counts_and_taxa_are_errors(self):
        report = self.audit(observations=[self.observation(APPROVED="", CATEGORY="unknown",
                                                          **{"OBSERVATION COUNT": "-1"})])
        self.assertEqual(set(report["errors"]), {"unknownReviewFlags", "invalidTaxonFields", "invalidObservationCount"})

    def test_mixed_release_or_subset_is_rejected(self):
        self.audit()
        for name in (self.sed.name.replace("Feb-2025", "Mar-2025"), self.sed.name.replace("009", "001")):
            path = self.root / name
            path.write_bytes(self.sed.read_bytes())
            with self.assertRaisesRegex(InputError, "filenames do not match"):
                audit_inputs(self.ebd, path)

    def test_missing_and_duplicate_columns_are_rejected(self):
        for corrupt in (lambda s: s.replace("COUNTY CODE", "MISSING COLUMN", 1),
                        lambda s: s.replace("COUNTY CODE", "COUNTRY CODE", 1)):
            self.audit()
            self.sed.write_text(corrupt(self.sed.read_text()))
            with self.assertRaises(InputError):
                audit_inputs(self.ebd, self.sed)

    def test_malformed_row_cannot_shift_fields(self):
        self.audit()
        self.sed.write_text(self.sed.read_text().replace("2025-01-10", "2025-01-10\tunexpected"))
        with self.assertRaisesRegex(InputError, "column count"):
            audit_inputs(self.ebd, self.sed)

    def test_comments_are_not_parsed_as_quotes_or_exposed_in_report(self):
        secret = '"Synthetic private notes'
        report = self.audit(events=[self.event(**{"CHECKLIST COMMENTS": secret})])
        self.assertNotIn(secret, json.dumps(report))
        self.assertEqual(report["inputChecks"], "passed")

    def test_empty_sed_or_invalid_event_fields_are_rejected(self):
        with self.assertRaisesRegex(InputError, "sampling file is empty"):
            self.audit(events=[], observations=[])
        for field, value in (("OBSERVATION DATE", "2025-02-30"), ("GROUP IDENTIFIER", "S2"),
                             ("ALL SPECIES REPORTED", "")):
            with self.subTest(field=field), self.assertRaises(InputError):
                self.audit(events=[self.event(**{field: value})], observations=[])

    def test_cli_writes_only_new_report_and_returns_failure_for_invalid_join(self):
        self.audit(observations=[self.observation(self.event("S2"))])
        output = self.root / "audit.json"
        command = [sys.executable, "scripts/ebd_inputs.py", "--ebd", str(self.ebd),
                   "--sampling", str(self.sed), "--output", str(output)]
        completed = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(json.loads(output.read_text())["inputChecks"], "failed")
        previous = output.read_bytes()
        completed = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("never overwritten", completed.stderr)
        self.assertEqual(output.read_bytes(), previous)


if __name__ == "__main__":
    unittest.main()
