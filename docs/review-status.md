# Review and compatibility boundaries

- `pm-screen-independent-review` retains maintainer protocol approval and genuinely independent second-pass public judgments. Current mechanical agreement is not reviewer agreement.
- `pm-screen-sdk-transport` records SDK 2026.11.5's native collection-cursor validation before extension dispatch. The public `PmReadOutputCursorEnvelope` contract has no producer-owned continuation callback. Package `--cursor` and `--budget` are tested compatibility controls; they do not shadow globals or weaken the native contract.
- `pm-screen-providers` records the directory-only certification boundary. Published `PmClientOptions` accepts `pmRoot`, `cwd`, `author` and `noExtensions`, not arbitrary database/provider injection. Broader backend conformance is tracked upstream in pm-cli issues 1399, 1587 and 1588. The injected client port requires explicit guarantee assertions and must pass real-provider tests before advertising another backend.
- `pm-screen-later` retains cross-partition deduplicated unions, multi-stage screening, retrieval integrations and explicit future migrations. None is silently included in this release.

Native nested expected-revision scopes intentionally advance after a nested mutation. The package's scope callback therefore contains only its one native update, with no caller callback inside it. The interleaving regression protects this implementation choice; it is not presented as a newly filed upstream defect.

Implementation and review fixes are tracked in PR #1 on `feat/screen`. Review threads remain open for the orchestrator and reviewers to verify. Publication and maintainer approval remain separate gates.

The second review round closes five shared rules. Candidate selection first visits every untouched candidate for the selected reviewer, then offers uncertain assessments for an explicit amendment; selection remains read-only and does not allocate work. Submitted JSON scanning counts every value visit, including repeated object references and primitive array entries, against a 262144-node budget while retaining depth, text, cycle and property checks. Stored-record reads retain their compatibility policy.

Disposable Git tests exclude parent GitHub Actions, runner and CI context, and exercise foreign synthetic commit SHAs. The privileged publishing jobs exclude unused Bun setup; the read-only preparation and Bun acceptance jobs retain their pinned runtime. Every behavioral revert supplies an independent assertion or domain-error diagnostic. The shared harness rejects test-name-only oracles and unrelated named failures, restores exact source in disposable copies, rebuilds, and verifies the restored regression.
