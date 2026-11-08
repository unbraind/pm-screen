# Review and compatibility boundaries

- `pm-screen-independent-review` retains maintainer protocol approval and genuinely independent second-pass public judgments. Current mechanical agreement is not reviewer agreement.
- `pm-screen-sdk-transport` records SDK 2026.11.5's native collection-cursor validation before extension dispatch. The public `PmReadOutputCursorEnvelope` contract has no producer-owned continuation callback. Package `--cursor` and `--budget` are tested compatibility controls; they do not shadow globals or weaken the native contract.
- `pm-screen-providers` records the directory-only certification boundary. Published `PmClientOptions` accepts `pmRoot`, `cwd`, `author` and `noExtensions`, not arbitrary database/provider injection. Broader backend conformance is tracked upstream in pm-cli issues 1399, 1587 and 1588. The injected client port requires explicit guarantee assertions and must pass real-provider tests before advertising another backend.
- `pm-screen-later` retains cross-partition deduplicated unions, multi-stage screening, retrieval integrations and explicit future migrations. None is silently included in this release.

Native nested expected-revision scopes intentionally advance after a nested mutation. The package's scope callback therefore contains only its one native update, with no caller callback inside it. The interleaving regression protects this implementation choice; it is not presented as a newly filed upstream defect.

Implementation and review fixes are tracked in PR #1 on `feat/screen`. Review threads remain open for the orchestrator and reviewers to verify. Publication and maintainer approval remain separate gates.
