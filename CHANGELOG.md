# Changelog

## 2026.11.6 - 2026-11-06

### Added

- Frozen protocol and exact eligibility accounting ([pm-screen-protocol](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/features/pm-screen-protocol.toon))
- Native concurrent screening workflow and bounded CLI SDK ([pm-screen-workflow](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/features/pm-screen-workflow.toon))
- Public corpus proof and release certification ([pm-screen-evidence](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/features/pm-screen-evidence.toon))

### Fixed

- Refuse sparse arrays of any length, and dense arrays past the aggregate node budget, before schema validation ([pm-screen-buon](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/issues/pm-screen-buon.toon))

### Other

- Close delivered items and return idle in-progress items to open (2026-11-14 sweep) ([pm-screen-sweep-1114](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/chores/pm-screen-sweep-1114.toon))
- Durable evidence screening first release ([pm-screen-delivery](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/epics/pm-screen-delivery.toon))
- Keep required CI check names stable under exact Node pins ([pm-screen-31bz](https://github.com/unbraind/pm-screen/blob/main/.agents/pm/tasks/pm-screen-31bz.toon))
