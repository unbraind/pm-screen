# Architecture

`pm-screen` is a context ledger for evidence selection. The caller supplies a frozen frame and records judgments; the package never retrieves or classifies sources. Native pm storage, authorization, locking, history and retention remain host-owned.

## Native records

Activation registers `Screening` in `screenings` and the optional object field `screen_state`. It writes no data. The explicit directory SDK creation route provisions compatible missing project schema through the SDK, refusing incompatible definitions. One owner stores version 1, package identity, frozen definition, protocol/population/source-manifest digests, current assessments, adjudications and operation receipts. There are no authoritative side files, package locks or subprocesses.

The definition includes question, protocol, population and optional predecessor snapshot. Creation pins its digest in the first operation result. The protocol and population remain immutable; changes require a successor owner. The predecessor gets a native related link. Each create/update also appends one audit comment in the same native mutation. Source items, their status, claims and other fields are untouched. Item history preserves prior assessment/adjudication states.

## Criteria, aliases and decisions

A criterion has a stable ID, inclusion/exclusion kind, inert description and explicit required-evidence flag. Protocol reason order enumerates every criterion once. Every assessment includes one ternary value for every criterion, reasons and typed evidence references, plus protocol/source digests and recorder/time attribution. Object keys are canonicalized; set-like arrays use stable ordering. Whitespace normalization is shared by write and replay comparisons. Internal line breaks remain data.

Include requires all inclusion values met and all exclusion values not met, with required evidence. Exclude requires evidence witnessing a failed inclusion or met exclusion. Missing evidence alone never excludes. A witnessed exclusion may coexist with unknown criteria, which remain in its witness. One deterministic primary criterion counts each excluded candidate once; all witnessed-reason frequencies may overlap.

Two slots are distinct attribution keys. Absent assessment is pending. Contradictory values or final dispositions conflict even if both slots say exclude. Values are compared by criterion ID, including native snapshots whose equivalent vectors have different array ordering. Adjudication records a complete chosen vector, rationale and exact current assessment digests. Amendment requires the current assessment digest and reason; old adjudication then becomes stale and cannot silently determine eligibility. Resolving retains the opposed assessments.

The smallest lexical entry ID is each canonical candidate's representative. Every additional entry needs a submitted exact alias witness naming that representative, with matching source content digest and explicit identity evidence. There is no fuzzy merging. `imported = canonical + aliases`; `canonical = included + excluded + pending + uncertain + conflict`. Every report carries the full denominator, all unresolved identities and both conservation checks. A complete submitted frame is a caller claim, not proof of search recall.

## Native concurrency and resume

Create uses native create-if-absent under an explicit ID. Duplicate recovery verifies package/schema and original normalized request digest before adoption. Each change reads one selected owner completely, checks a replay key, checks the caller revision and computes the entire proposed state before entering a native revision scope. The scope callback performs exactly one native update. No optional boundary callback runs inside that scope: nested writes intentionally advance native invocation expectations.

`withExpectedItemRevisions([{id,itemHash}], update)` checks the hash under the host's item write lock. The result must name the owner in `checked` with no unchecked guard. No automatic rebase occurs. A peer winning the race produces a typed revision conflict; callers reread and make an explicit new decision. Append-only operation receipts prevent ABA within package mutations and retain all successful deduplication identities.

Replay lookup follows authorized owner validation and precedes revision comparison only for an identical normalized request. Changed payload with the same key refuses. A replay returns the original result/request digests and sequence, plus the current observed item revision, which may include newer decisions. No extra history event is written. Interrupted calls retain the original operation key: complete read-back can prove committed or not committed at the observed revision; unavailable read-back remains outcome unknown. Never use a fresh key to conceal an ambiguous outcome.

Tests inject competing writes and crashes at every exposed boundary; separate OS writers and hard exits prove process-independent recovery. The 500-sequence model checks native reads, old-request replay, whitespace, relationships and exact audit-event effects against independent maps. SDK clients are real; the extension harness uses actual temp trackers. Additional adapters must supply explicit native guarantees rather than emulate them with a package mutex.

## Source freshness

Native references pin item ID/hash, JSON pointer and content digest. Public artifacts pin an HTTPS URI and content digest. No referenced body is automatically copied. `check` validates stored manifest identity; an optional authorized adapter inspects references and returns current, changed, missing, inaccessible or unknown. The CLI has no source adapter and reports unknown. Drift never substitutes a new source into an assessment. A historical report can be complete for its frozen frame while current freshness is changed or unknown.

## Output, settings and privacy

CLI and SDK use the same API, strict nested schemas, pure eligibility reducer and host whole-envelope fitter. Default budget is 1600 estimated tokens, including final JSON/TOON framing and fit metadata, at ceil(UTF-8 bytes/4). A page cannot exceed 32768 bytes. Counts, criteria, source pins, unknowns and qualifications are mandatory. Packet fitting removes whole candidate rows only. Page size is 20 by default, with an explicit 1..100 limit. A cursor pins owner revision, query, limit and stable ordering. `omitted` covers all absent query rows, `remaining` covers future rows, and `output_complete` never treats the last partial page as the entire population.

Write-result preflight reserves the actual result, request digest and fixed-length current revision before mutation. An indivisible witness refuses with a measured minimum retry budget or a narrower-query remedy. Native post-processing that removes witnesses is refused by the final renderer. Package `--budget` and `--cursor` are explicit compatibility controls for pinned host transport limits; native flags are never shadowed. The optional host setting is `screen.output_budget`.

The mutation privacy guard scans every submitted string with SDK `scanMutationSecrets`, then strict schemas enforce limits. Absolute home paths outside public web URI text, unsafe controls/bidi, malformed Unicode and prototype keys refuse; instructions are never evaluated. Email addresses refuse everywhere, including inside URI text. Identity keys use maps and own-key checks. Secret scanning is heuristic. Historical correction does not erase append-only native history. Hosts own permissions, redaction and retention.

## Limits and release boundary

The first release supports one stage, 1..12 criteria, one/two slots, at most 128 input entries/canonical candidates, 512 operation receipts, 256 KiB canonical state, 160-code-point labels and 400-code-point reasons. Capacity refuses with a successor/partition remedy. No receipt eviction or read-time migration exists. Future schema migration must be an explicit revision-checked operation. Cross-partition unions, staged pipelines and retrieval integrations remain separate Features.

All domain commands work without Git. The directory adapter is tested, and callers can inject authorized conforming clients. Real arbitrary database/MCP backend certification remains separate from algorithm and directory guarantees. The package contains no network, shell, telemetry, crawler, parser, model runner or publishing integration. Future releases use the copied fleet approval gate and exact captured tarball; this local implementation creates no remote repository or release.
