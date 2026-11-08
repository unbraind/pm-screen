/** Original behavioral reverts each require an independent defect-specific diagnostic. */
export const mutations = [
  { file: 'kernel.ts', from: 'assessments[0].vector.some(value => value.value !== assessments[1].vector.find(other => other.criterion_id === value.criterion_id)!.value)', to: 'assessments[0].vector.some((value, i) => value.value !== assessments[1].vector[i].value)', name: 'criterion-identity', test: 'revert criterion identity', failure: /defect:criterion-identity/ },
  { file: 'kernel.ts', from: 'failed && value.evidence_refs.length > 0', to: 'failed', name: 'witnessed-exclusion', test: 'revert eligibility', failure: /defect:witnessed-exclusion/ },
  { file: 'kernel.ts', from: "value.value === 'unknown' ||", to: 'false ||', name: 'unknown-retention', test: 'revert eligibility', failure: /defect:unknown-retention/ },
  { file: 'api.ts', from: 'itemHash: input.revision', to: 'itemHash: (await host.client.readItemRevision(snapshot.id)).item_hash', name: 'native-cas', test: 'revert native CAS', failure: /defect:native-cas/ },
  { file: 'api.ts', from: 'const previous = replay(snapshot.state, input.op, normalized); if (previous)', to: 'const previous = replay(snapshot.state, input.op, normalized); if (previous && Boolean(0))', name: 'older-replay', test: 'revert original request replay', failure: /Caller revision is stale/ },
  { file: 'kernel.ts', from: 'const opposed = assessments.length === 2', to: 'const opposed = Boolean(0) && assessments.length === 2', name: 'criterion-disagreement', test: 'revert criterion conflicts', failure: /defect:criterion-disagreement/ },
  { file: 'kernel.ts', from: 'const stale = adjudication !== null', to: 'const stale = Boolean(0) && adjudication !== null', name: 'stale-adjudication', test: 'revert criterion conflicts', failure: /defect:stale-adjudication/ },
  { file: 'api.ts', from: 'preflight(host, snapshot.id, operation, options);', to: 'void options;', name: 'write-budget-preflight', test: 'revert write budget', failure: /defect:write-budget-preflight/ },
  { file: 'kernel.ts', from: ' && entry.source_ref.content_digest === first.source_ref.content_digest', to: '', name: 'exact-alias', test: 'revert alias witness', failure: /defect:exact-alias/ },
  { file: 'output.ts', from: "if ('output_budget_exceeded' in object || receipt?.strings_compacted", to: "if ('output_budget_exceeded' in object || false", name: 'native-compaction', test: 'revert host compaction', failure: /defect:native-compaction/ },
];
