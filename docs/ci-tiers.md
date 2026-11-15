# Fleet CI v2

Required PR checks keep their names `test (22)`, `test (26)` and `codeql`.
CI runs on pull requests and dispatch, cancels superseded PRs and bounds each
hosted job to 30 minutes. The runtime pins remain Node 22.19.0 and 26.0.0.

| Check | Code PR 22 | Code PR 26 | Docs/tracker PR, both | Deep 22 + 26 |
| --- | --- | --- | --- | --- |
| npm ci, authoritative tracker health | yes | yes | yes | npm + Bun gates |
| Strict pm health | — | — | yes | authoritative health in gates |
| Commit identity / tracked private paths | — | yes | yes | npm + Bun gates |
| Build / test typecheck | yes | yes | build for docs/package tests | npm + Bun gates |
| Unit, concurrency, SDK and model tests | quick | quick coverage | applicable privacy/docs tests | full, npm + Bun gates |
| Lint, duplication, docstrings | — | yes | — | npm + Bun gates |
| Coverage: 100% statements/branches/functions/lines | — | quick | — | full, npm + Bun gates |
| Production dependency audit | — | yes | — | npm + Bun gates |
| Package public file allowlist | — | yes | yes | npm + Bun gates |
| Changelog consistency | — | yes | yes | npm + Bun gates |
| Publish attestation verification | — | yes | — | npm + Bun gates |
| Packed npm/Bun/npx/bunx consumer acceptance | — | yes | — | npm + Bun gates |
| Behavioral revert proofs | — | yes | — | npm + Bun gates |
| Bun dependency graph install smoke | — | yes | — | yes |
| Identity, submission privacy, corpus boundaries, README and receipt tests | via suite | via suite | yes | npm + Bun gates |
| CodeQL | separate required workflow on every PR/main push and weekly Monday 01:47 UTC | same | same | same |

Deep runs on main pushes, dispatch and nightly at 02:31 UTC, separate from
release (05:37 UTC plus the hourly :41 recovery cron). Checks `deep (22)` and
`deep (26)` run both complete npm and Bun release gates with full depth and
`PM_TEST_TIME_SCALE=3`. Jobs use the `pm-local` pool unless `PM_LOCAL_DEEP=off`,
then GitHub-hosted runners; per-ref concurrency cancels superseded runs and each
job has a 120-minute limit. Local npm uses its persistent cache, local Bun is
preinstalled and its version is logged. Release workflows/verifiers are unchanged.

Only repetitive model sequences shrink: quick runs the first 50 of the same
500 operations with the same generator and assertions. Unset depth means full.
Large privacy/receipt fixtures test product boundaries and remain unchanged.
Changed unit-suite harness child-process timeouts scale with finite positive factors, rounded up to
integer milliseconds before spawn; product budgets are unchanged. Coverage policy
remains 100% in all four dimensions without exclusions.

Docs/tracker detection compares NUL-delimited PR base/head paths with renames
disabled. Executable tracker files select the code tier. The cheap path retains
identity/private-path and corpus-privacy checks, README assertions, real-data
receipt/policy tests and the package allowlist because they read public documents.
It builds the package to make these checks meaningful. CodeQL is required and
has no path filters. The packed acceptance already installs using npm and Bun
and runs npx and bunx with Git absent, so no second Bun gate is needed in PR CI.

Baseline successful main run 43656673307: required job walls including queue
were 56m25s (22) and 78m06s (26); execution was 2m42s and 14m19s. Logs show
full 500-operation model runs at 30.68–50.39s and packed acceptance at
110.28–134.14s. These are historical hosted measurements, not a same-host
quick/full benchmark. Full depth is intentionally not run locally; deep CI
certifies it after merge. Local quick coverage passed 87/87 tests in 354.52s of suite time at unchanged
100% thresholds; the model took 52.18s under contention. These measurements
are not directly comparable with hosted full-depth timings. Existing release
packed-install and revert-proof scripts retain their original budgets and remain untouched.
New PR timing is recorded in the task and PR body.
