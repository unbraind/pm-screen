# Public screening proof

The fixture freezes three separate candidate frames. Domain commands read none of the source candidates; the acquisition script is a separate, explicitly invoked test utility. It checks public repository metadata, downloads only pinned public tracker snapshots into disposable copies, certifies complete SDK lists, and selects the first 20 IDs per tracker. No canonical source tracker or private repository is read or modified.

The four public snapshots contain 138 pm-csv, 119 pm-beads, 163 pm-ops and 103 pm-brief items. Their commit IDs, selected IDs and artifact digests are in `test/fixtures/public-corpus.json`. Public issues are all open non-PR issues from pm-csv, pm-beads and pm-brief, with REST pagination exhausted. Search hits retain the exact submitted query; search engine recall is unknown.

Criteria were recorded in `docs/policy-examples.md` before acquisition. Each frozen row has a source digest, bounded label, criterion vector and recorded reason. Native reference content digests hash the exact complete JSON item projection; the empty JSON pointer identifies that snapshot. Original raw candidate byte counts are retained without copying authors or full tracker bodies into public fixtures.

| Frame | Candidates | Included | Excluded | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Open issues: release-workflow failures | 5 | 3 | 2 | 0 |
| Four public trackers: explicit SDK capability gaps | 80 | 2 | 74 | 4 uncertain |
| Search hits: lost or omitted context | 2 | 1 | 1 | 0 |

Every imported real candidate has one canonical identity; real alias count is zero. For every report, imported equals canonical plus aliases, and canonical equals included plus excluded plus pending plus uncertain plus conflict. All candidates are accounted for. The 80-item frame remains incomplete as a screening decision because four candidates are explicitly uncertain; that is distinct from complete accounting.

The tracker frame's primary exclusion counts are 10 under the release/version-only criterion and 64 under the inclusion criterion. Both open-issue exclusions use the package-behavior criterion. The excluded search hit fails the context-loss inclusion criterion. All witnessed secondary reasons remain available and may overlap. Reasons and unresolved identities are in the machine receipt and fixture.

## Mechanical correctness and reviewer limits

All 87 submitted real criterion vectors match the independent mechanical truth table and explicit expected-ID sets. The oracle does not call the production reducer. This checks implementation consistency, not the scientific or domain accuracy of the submitted judgments.

One implementing recorder prepared the public judgments. No second independent reviewer or maintainer protocol approval was supplied. Agreement, blinding and independent adjudication are therefore **not measured**. A package Feature retains that acceptance work for the orchestrator. Two named slots alone would not establish independence; no second pass has been fabricated.

The synthetic controls are separate: five exact aliases, ten unavailable-source candidates, three criterion disagreements and one changed source. Counts remain 15 imported = 10 canonical + 5 aliases. Before disagreement, all ten canonical candidates are uncertain and none excluded. After disagreement, seven are uncertain and three conflict. A changed-source adapter yields changed freshness without rewriting historical decisions.

## Bytes and resume

| Frame | Raw bytes | Packet bytes (all pages) | Raw estimated tokens | Packet estimated tokens | Pages | Largest page tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Open issues | 7,459 | 16,992 | 1,865 | 4,248 | 3 | 1,587 |
| Tracker items | 414,644 | 391,811 | 103,661 | 97,953 | 80 | 1,251 |
| Search hits | 6,555 | 6,066 | 1,639 | 1,517 | 1 | 1,517 |

`docs/real-data-receipt.json` records exact final envelopes, pages, tokens and ten resume questions. Estimates are ceil(UTF-8 bytes/4), not actual model-token usage. The full packet stream includes repeated population receipts and source witnesses; small corpora can cost more than their raw inputs. This is reported rather than presented as universal compression.

Ten resume questions ask for a named candidate's disposition and exact recorded reason together with the complete population counts. Each answer is checked against the frozen notes and independent expected decisions, and each packet obeys the default 1600-token ceiling. The baseline rereads the same complete raw candidate frame plus screening notes for each question; the packet restores the answer and exact counts directly. This is a cold-resume comparison, not a claim against a cached manual index, a live-agent efficiency measurement or a provider token benchmark.

Regenerate the recorded numbers with `npm run test:real-data`. Normal release tests consume the frozen public fixtures without network access. The explicit `node scripts/acquire-corpus.ts` command only prepares an ignored review file; it never changes the submitted judgments automatically. Corpus policy and read-boundary canaries reject private repositories, new unreviewed read roots and credential-shaped content.
