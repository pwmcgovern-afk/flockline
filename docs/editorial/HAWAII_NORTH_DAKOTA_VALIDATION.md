# Hawaii and North Dakota source validation

Checked November 17, 2026. Registry: review-lists-2026-11-17-hi-validation.

The Hawaii review is complete as a bounded review of the public primary sources found. It does not establish a complete current lifetime-record total for every historical species. No current replacement North Dakota review list was verified.

## Hawaii decisions

The [current HBRC page](https://westernfieldornithologists.org/hawaii-birds-records-committee/) requests reports of species new to the Hawaiian Islands or recorded five or fewer times. The [2025 second report](https://www.journal.westernfieldornithologists.org/index.php/westernbirds/article/view/354), with an [author-hosted PDF](https://pacificrimconservation.org/wp-content/uploads/2025/10/VanderWerf-et-al-2025-2nd-report-of-HBRC-compressed.pdf), covers committee decisions through 2024. Neither is a live record-count database.

The [2017 checklist, revised through 2018 taxonomy](https://westernfieldornithologists.org/wp-content/uploads/2020/06/Hawaiian_Islands_Bird_Checklist-Jan-2019.pdf) defines Va as five or fewer records, but describes its X review marks as approximately five or fewer occurrences per decade. Va is therefore a dated upper bound. Neither that status nor old X membership proves a current lifetime total. The [2018 first report](https://pacificrimconservation.org/wp-content/uploads/2018/06/VanderWerf-et-al.-2018-HBRC-report-Western-Birds.pdf) provides accepted historical records, but does not fill the later lifetime-count gap.

The checked-in [validation ledger](../../shared/hawaiiDigestValidation.json) accounts for 127 species/taxon decisions: 23 eligible, 99 held, and five excluded. It is a curated factual ledger with source URLs and report page numbers for the 2025 decisions, not a raw source capture or a complete Hawaiian checklist.

| Decision | Evidence and effect |
| --- | --- |
| 23 automatic rules | Explicit first, second, or third records in the 2025 report. The new Iceland Gull rule uses the report's accepted first species record, identified as thayeri (printed page 11). The current policy applies to species counts; this does not assert records for any other form. |
| Common Gull excluded | Six accepted records (printed page 9), exceeding the published five-or-fewer threshold. |
| Snow Bunting excluded | Sixth accepted record (printed page 17), exceeding that threshold. |
| Mew Gull excluded | Obsolete combined taxon. The report reconciles Common Gull and Short-billed Gull separately (printed pages 9-10). |
| Rosy-faced Lovebird excluded | Established introduced population, not a low-record vagrant (printed page 15). |
| Cocos Booby excluded | Increasing occurrence and breeding populations; the report supplies no qualifying low lifetime total (printed page 4). |
| American Pipit held | Its post-split record remains under committee recirculation, without a final decision in the 2025 report (printed page 4). |
| Other historical entries held | No sufficiently current total was found. Taxonomic splits/lumps and historical breeding status have specific hold reasons. |

The eleven recovered historical entries are Falcated Duck, Common Pochard, Black Scoter, Common Cuckoo, Fork-tailed Swift, Long-toed Stint, Salvin's Albatross, Bryan's Shearwater, Black Kite, Baird's Sandpiper, and American Pipit. Nine had two X marks (Midway-only and review columns); page-boundary text also obscured Baird's Sandpiper and American Pipit. They remain held. No older species was promoted on the assumption that an absent later account means no additional records.

The committee area includes Midway Atoll, which is outside the state of Hawaii. Published counts describe occurrences/accepted records, not individual birds, observer checklists, or an eBird acceptance decision. New explanation copy states the source year, coverage through 2024, and geographic scope. eBird acceptance remains separately required for automatic publication.

## Remaining Hawaii evidence

The 99 holds require an updated committee list or affirmative species-level record totals, with taxonomy reconciliation where relevant. No newer comprehensive primary list or third HBRC report was found in the committee page, journal searches, or the [committee chair's publication index](https://pacificrimconservation.org/publications/). The current page still points to the second report. This search result is not proof that no unpublished committee decisions exist.

Do not clear these holds using raw eBird checklist counts, iNaturalist counts, the old Va/X labels alone, or an inference from silence in the 2025 report.

## North Dakota source search

The retained primary source is the [June 14, 2026 archived committee review list](https://web.archive.org/web/20260614135951/https://ndbirdingsociety.org/Birds/Records.aspx), with 114 matched species rules and four condition holds. This pass found no verifiable newer replacement.

| Check | Result |
| --- | --- |
| Original committee endpoint, HTTPS and HTTP | Redirected to unrelated gambling content. Do not publish the live domain as a trustworthy explanatory link. |
| Original homepage | Timed out. |
| www .org and legacy .com variants | No accessible current committee list verified. |
| Society field-checklist PDF | Search/open tools returned a cached 417-species PDF with a 2026 copyright, but a fresh URL was inaccessible. A copyright year is not a revision date or proof of current review criteria. |
| Search for a new society domain, current committee list, and recent committee reports | No newer authoritative replacement was verified. Older committee reports, government conservation lists, and third-party checklists do not replace current committee review criteria. |

The registry retains the archived explanatory URL, archive date, conditions, and source scope. It does not upgrade an old search cache to a current live source. No committee outreach or email was sent.

## Rebuild and checks

Run the two original Northeast import scripts, then scripts/import-national-digest-rules.mjs with the preserved national and Northeast capture directories. The final Hawaii reconciliation reads shared/hawaiiDigestValidation.json and replaces only Hawaii's generated rules. Its focused test verifies every ledger decision, dated explanation copy, exact regeneration, idempotence, and preservation of every other state's rules.
