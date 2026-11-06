import { canonical, digest, parse, DefinitionSchema, ProtocolSchema, VectorSchema, ScreeningStateSchema } from './schema.ts';
import type { Definition, Protocol, Vector, ScreeningState } from './schema.ts';
import { insist } from './errors.ts';
/** Stable lexicographic comparison independent of machine locale. */
export function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
/** Normalize a set of references through their canonical content identity. */
export function sortedRefs<T>(refs: T[]): T[] { return [...new Map(refs.map(ref => [canonical(ref), ref])).entries()].sort(([a], [b]) => compare(a, b)).map(([, ref]) => ref); }
/** Require unique identities with a domain-specific refusal. */
function unique(ids: string[], code: string): void { insist(new Set(ids).size === ids.length, code, 'Duplicate identity in the submitted contract'); }
/** Validate protocol identities and exhaustive deterministic reason ordering. */
export function validateProtocol(protocol: Protocol): void {
  const ids = protocol.criteria.map(c => c.criterion_id); unique(ids, 'protocol_mismatch'); unique(protocol.reviewer_slots, 'protocol_mismatch');
  insist(canonical([...ids].sort()) === canonical([...protocol.primary_reason_order].sort()), 'protocol_mismatch', 'Primary reason order must enumerate every criterion exactly once');
}
/** Normalize unordered declaration fields before both persistence and replay comparison. */
export function normalizeDefinition(raw: Definition): Definition {
  const value = parse(DefinitionSchema, raw); validateProtocol(value.protocol);
  value.protocol.criteria.sort((a, b) => compare(a.criterion_id, b.criterion_id)); value.protocol.reviewer_slots.sort();
  value.population.entries.sort((a, b) => compare(a.entry_id, b.entry_id)); value.population.acquisition_refs = sortedRefs(value.population.acquisition_refs);
  value.population.alias_witnesses.sort((a, b) => compare(a.entry_id, b.entry_id));
  for (const alias of value.population.alias_witnesses) alias.evidence_refs = sortedRefs(alias.evidence_refs);
  validatePopulation(value); return value;
}
/** Validate exact aliases against one stable representative per canonical candidate. */
export function validatePopulation(definition: Definition): void {
  const { entries, alias_witnesses: aliases } = definition.population; unique(entries.map(e => e.entry_id), 'invalid_population'); unique(aliases.map(a => a.entry_id), 'invalid_alias');
  const primary = new Map<string, typeof entries[number]>(); const duplicates: string[] = [];
  for (const entry of [...entries].sort((a, b) => compare(a.entry_id, b.entry_id))) {
    const first = primary.get(entry.canonical_candidate_id);
    if (!first) { primary.set(entry.canonical_candidate_id, entry); continue; }
    duplicates.push(entry.entry_id); const witness = aliases.find(a => a.entry_id === entry.entry_id);
    insist(witness && witness.canonical_entry_id === first.entry_id && entry.source_ref.content_digest === first.source_ref.content_digest, 'invalid_alias', 'Alias needs exact identity evidence and the canonical entry reference', 'Supply one witness per duplicate; do not fuzzy-merge similar sources');
  }
  insist(canonical(duplicates.sort()) === canonical(aliases.map(a => a.entry_id).sort()), 'invalid_alias', 'Alias witnesses must correspond exactly to duplicate entries');
}
/** Stable candidate representatives; an alias never becomes an extra judgment. */
export function candidates(state: ScreeningState) {
  const map = new Map<string, Definition['population']['entries'][number]>();
  for (const entry of [...state.definition.population.entries].sort((a, b) => compare(a.entry_id, b.entry_id))) if (!map.has(entry.canonical_candidate_id)) map.set(entry.canonical_candidate_id, entry);
  return [...map.entries()].sort(([a], [b]) => compare(a, b)).map(([, entry]) => entry);
}
/** Find a frozen canonical identity or refuse without changing anything. */
export function candidate(state: ScreeningState, key: string) {
  const found = candidates(state).find(entry => entry.canonical_candidate_id === key); insist(found, 'invalid_population', 'Candidate is outside the frozen population', 'Use a canonical ID from screen packet'); return found;
}
/** Normalize a complete vector against the exact declared criteria. */
export function normalizeVector(protocol: Protocol, raw: Vector): Vector {
  const vector = parse(VectorSchema, raw);
  insist(canonical(vector.map(v => v.criterion_id).sort()) === canonical(protocol.criteria.map(c => c.criterion_id).sort()), 'missing_criterion', 'Assessment must contain each criterion exactly once', 'Supply unknown with a reason when evidence is unavailable');
  return vector.map(value => ({ ...value, evidence_refs: sortedRefs(value.evidence_refs) })).sort((a, b) => compare(a.criterion_id, b.criterion_id));
}
/** Pure ternary eligibility; unavailable evidence never causes an exclusion. */
export function deriveEligibility(rawProtocol: Protocol, rawVector: Vector) {
  const protocol = parse(ProtocolSchema, rawProtocol); validateProtocol(protocol); const vector = normalizeVector(protocol, rawVector);
  const exclusions: string[] = []; const unknown: string[] = [];
  for (const criterion of protocol.criteria) {
    const value = vector.find(v => v.criterion_id === criterion.criterion_id)!;
    const failed = criterion.kind === 'inclusion' ? value.value === 'not_met' : value.value === 'met';
    if (failed && value.evidence_refs.length > 0) exclusions.push(criterion.criterion_id);
    if (value.value === 'unknown' || ((criterion.required_evidence || failed) && value.evidence_refs.length === 0)) unknown.push(criterion.criterion_id);
  }
  const reasons = protocol.primary_reason_order.filter(id => exclusions.includes(id));
  return { disposition: reasons.length > 0 ? 'excluded' as const : unknown.length > 0 ? 'uncertain' as const : 'included' as const, primary_reason: reasons[0] ?? null, exclusion_reasons: reasons, unknown_criteria: unknown.sort() };
}
/** A candidate retains all submitted slot vectors and unresolved disagreements. */
export function disposition(state: ScreeningState, key: string) {
  const assessments = state.assessments.filter(a => a.candidate === key).sort((a, b) => compare(a.reviewer, b.reviewer));
  const absent = state.definition.protocol.reviewer_slots.filter(slot => !assessments.some(a => a.reviewer === slot));
  const adjudication = state.adjudications.find(a => a.candidate === key) ?? null;
  const stale = adjudication !== null && canonical([...adjudication.assessment_digests].sort()) !== canonical(assessments.map(a => a.assessment_digest).sort());
  const opposed = assessments.length === 2 && assessments[0].vector.some(value => value.value !== assessments[1].vector.find(other => other.criterion_id === value.criterion_id)!.value);
  const eligible = assessments.map(a => deriveEligibility(state.definition.protocol, a.vector));
  const labelsDiffer = eligible.length === 2 && eligible[0].disposition !== eligible[1].disposition;
  const conflict = stale || opposed || labelsDiffer;
  const effective = absent.length > 0 ? 'pending' : adjudication && !stale ? 'resolved' : conflict ? 'conflict' : 'assessed';
  const vector = effective === 'resolved' ? adjudication!.vector : assessments[0]?.vector ?? [];
  const derived = ['resolved', 'assessed'].includes(effective) ? deriveEligibility(state.definition.protocol, vector) : { disposition: effective as 'pending' | 'conflict', primary_reason: null, exclusion_reasons: [], unknown_criteria: state.definition.protocol.criteria.map(c => c.criterion_id) };
  return { candidate: key, ...derived, missing_reviewers: absent, stale_adjudication: stale, assessments, adjudication };
}
/** Exact attrition with the submitted population as the explicit denominator. */
export function deriveScreeningReport(state: ScreeningState) {
  state = readState(state);
  const rows = candidates(state).map(e => disposition(state, e.canonical_candidate_id));
  const counts = { included: 0, excluded: 0, pending: 0, uncertain: 0, conflict: 0 };
  const primary = new Map<string, number>(); const secondary = new Map<string, number>();
  for (const row of rows) {
    counts[row.disposition]++;
    if (row.primary_reason) primary.set(row.primary_reason, (primary.get(row.primary_reason) ?? 0) + 1);
    for (const id of row.exclusion_reasons) secondary.set(id, (secondary.get(id) ?? 0) + 1);
  }
  const imported = state.definition.population.entries.length; const aliases = state.definition.population.alias_witnesses.length; const canonicalCount = rows.length;
  return { question: state.definition.question, protocol: state.definition.protocol, scope_description: state.definition.population.scope_description, imported, canonical: canonicalCount, aliases, counts, primary_reasons: [...primary].sort().map(([criterion, count]) => ({ criterion, count })), all_witnessed_reasons: [...secondary].sort().map(([criterion, count]) => ({ criterion, count })), secondary_totals_may_overlap: true as const,
    unresolved: rows.filter(r => ['pending', 'uncertain', 'conflict'].includes(r.disposition)).map(r => ({ candidate: r.candidate, disposition: r.disposition })),
    receipt: { population_digest: state.population_digest, protocol_digest: state.protocol_digest, source_manifest_digest: state.source_manifest_digest, imported_equals_canonical_plus_aliases: imported === canonicalCount + aliases, canonical_equals_disposition_sum: canonicalCount === Object.values(counts).reduce((a, b) => a + b, 0), accounted_for: canonicalCount, decisions: counts.included + counts.excluded, unresolved: counts.pending + counts.uncertain + counts.conflict, complete_accounting: true as const, screening_complete: counts.pending + counts.uncertain + counts.conflict === 0 },
    source_completeness: state.definition.population.declared_complete ? 'declared_complete' as const : 'declared_partial' as const, current_freshness: 'unknown' as const, reviewer_slots: state.definition.protocol.reviewer_slots, independent_review_verified: false as const };
}
/** Hash only the declared source versions in stable candidate order. */
export function sourceManifest(definition: Definition): string { return digest(definition.population.entries.map(e => ({ entry_id: e.entry_id, source_ref: e.source_ref }))); }
/** Reject malformed or tampered native records without any read-time migration. */
export function readState(raw: unknown): ScreeningState {
  const state = parse(ScreeningStateSchema, raw, true); const { definition } = state;
  insist(Buffer.byteLength(canonical(state)) <= 262144, 'capacity_exceeded', 'Screening exceeds 256 KiB', 'Partition into successor populations; never evict replay identities');
  validateProtocol(definition.protocol); validatePopulation(definition);
  insist(state.protocol_digest === digest(definition.protocol) && state.population_digest === digest(definition.population) && state.source_manifest_digest === sourceManifest(definition), 'invalid_record', 'Frozen manifest identity differs');
  insist(state.operation_receipts[0].result.kind === 'create' && state.operation_receipts[0].result.digest === digest(definition), 'invalid_record', 'Creation identity no longer matches the frozen definition');
  unique(state.assessments.map(a => `${a.candidate}/${a.reviewer}`), 'invalid_record'); unique(state.adjudications.map(a => a.candidate), 'invalid_record'); unique(state.operation_receipts.map(o => o.operation_id), 'invalid_record');
  for (const assessment of state.assessments) {
    const { assessment_digest: expected, ...content } = assessment;
    insist(digest(content) === expected && state.protocol_digest === assessment.protocol_digest && digest(candidate(state, assessment.candidate).source_ref) === assessment.source_digest && definition.protocol.reviewer_slots.includes(assessment.reviewer), 'invalid_record', 'Stored assessment binding differs');
    normalizeVector(definition.protocol, assessment.vector);
  }
  for (const decision of state.adjudications) { candidate(state, decision.candidate); normalizeVector(definition.protocol, decision.vector); }
  for (const [i, operation] of state.operation_receipts.entries()) insist(operation.result.sequence === i + 1 && operation.result_digest === digest(operation.result), 'invalid_record', 'Replay result identity differs');
  return state;
}
