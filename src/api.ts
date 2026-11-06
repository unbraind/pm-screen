import { isItemAlreadyExistsError } from '@unbrained/pm-cli/sdk';
import { capable } from './host.ts';
import type { Host, Snapshot } from './host.ts';
import { insist, ScreeningRefusal, refusal } from './errors.ts';
import { parse, digest, canonical, CreateScreeningInputSchema, AssessCandidateInputSchema, ResolveInputSchema, ReportInputSchema, NextScreeningInputSchema, PacketInputSchema, KeySchema } from './schema.ts';
import type { ScreeningState, CreateScreeningInput, AssessCandidateInput, ResolveInput, ReportInput, NextScreeningInput, PacketInput } from './schema.ts';
import { readState, normalizeDefinition, normalizeVector, sourceManifest, candidate, candidates, deriveEligibility, deriveScreeningReport, disposition } from './kernel.ts';
import { envelope, fitEnvelope, outputOptions } from './output.ts';
import type { MutationReceipt, OutputOptions, ScreeningData } from './output.ts';
/** Read one authorized owner completely; reads never activate a migration. */
export async function readScreening(host: Host, rawId: string): Promise<Snapshot> {
  capable(host); const id = parse(KeySchema, rawId);
  try {
    const got = await host.client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' });
    insist('item' in got && 'item_hash' in got && typeof got.item_hash === 'string', 'incomplete_read', 'Host omitted the selected owner revision', 'Obtain a complete authorized owner read');
    insist(got.item.type === 'Screening', 'invalid_record', 'Selected owner is not a Screening'); return { id: got.item.id, revision: got.item_hash, state: readState(got.item.screen_state) };
  } catch (error) { if (refusal(error).code === 'item_not_found') throw new ScreeningRefusal('not_found', 'Screening owner was not found', 'Select an existing authorized owner'); throw refusal(error); }
}
/** Optional test/observability boundary has no authority over durable state. */
async function boundary(host: Host, step: string): Promise<void> { await host.boundary?.(step); }
/** Check a replay after owner validation but before the caller revision check. */
function replay(state: ScreeningState, op: string, request: unknown) {
  const found = state.operation_receipts.find(row => row.operation_id === op);
  if (found) insist(found.request_digest === digest(request), 'operation_conflict', 'Operation key belongs to another request', 'Reuse the exact original request or consciously choose a new key'); return found;
}
/** Retain deduplication identity up to the explicit capacity, never evicting keys. */
function remember(state: ScreeningState, op: string, request: unknown, kind: 'create' | 'assess' | 'resolve', identity: string, content: unknown) {
  insist(state.operation_receipts.length < 512, 'capacity_exceeded', 'Screening has reached 512 replay receipts', 'Create a reviewed successor or partition; retain all original operation keys');
  const result = { kind, identity, sequence: state.operation_receipts.length + 1, digest: digest(content) };
  const operation = { operation_id: op, request_digest: digest(request), result, result_digest: digest(result) }; state.operation_receipts.push(operation); readState(state); return operation;
}
/** Bound all successful SDK responses using the same whole-envelope fitter as CLI. */
function bounded<T extends ScreeningData>(host: Host, value: T, options: OutputOptions): T { fitEnvelope(host, envelope(value), options.budget); return value; }
/** Reserve the actual committed result before any mutation or schema provisioning. */
function preflight(host: Host, id: string, operation: ScreeningState['operation_receipts'][number], options: OutputOptions): void {
  bounded(host, { owner_id: id, revision: 'f'.repeat(64), ...operation, replayed: false, outcome: 'committed' }, options);
}
/** Read back the current revision while retaining the original semantic result. */
async function receipt(host: Host, id: string, operation: ScreeningState['operation_receipts'][number], replayed: boolean): Promise<MutationReceipt> {
  await boundary(host, 'before_receipt'); const current = await host.client.readItemRevision(id);
  return { owner_id: id, revision: current.item_hash, ...operation, replayed, outcome: 'committed' };
}
/** Create a frozen population once using native create-if-absent identity. */
export async function createScreening(host: Host, raw: CreateScreeningInput, options: OutputOptions = {}): Promise<MutationReceipt> {
  try {
    capable(host); options = await outputOptions(host, options); const submitted = parse(CreateScreeningInputSchema, raw); const { id: rawId, op, ...definition } = submitted;
    const id = await host.normalizeId?.(rawId) ?? rawId; const normalized = normalizeDefinition(definition); const input = { id, op, ...normalized };
    const state: ScreeningState = { version: 1, package: 'pm-screen', definition: normalized, protocol_digest: digest(normalized.protocol), population_digest: digest(normalized.population), source_manifest_digest: sourceManifest(normalized), assessments: [], adjudications: [], operation_receipts: [] };
    const operation = remember(state, op, input, 'create', id, normalized); preflight(host, id, operation, options);
    await host.prepareCreate?.(); await boundary(host, 'before_create');
    try {
      const result = await host.client.create({ id, title: normalized.question, type: 'Screening', field: [`screen_state=${canonical(state)}`], comment: ['screen:create frozen protocol and population; submitted text is data'], dep: normalized.predecessor ? [`id=${normalized.predecessor.item_id},kind=related`] : [] });
      await boundary(host, 'after_create'); return await receipt(host, result.item.id, operation, false);
    } catch (error) {
      if (!isItemAlreadyExistsError(error)) throw error;
      const current = await readScreening(host, id); const original = replay(current.state, op, input);
      insist(original?.result.kind === 'create' && original.result.sequence === 1, 'operation_conflict', 'Existing owner belongs to a different create request', 'Choose a new explicit owner identity'); return await receipt(host, current.id, original, true);
    }
  } catch (error) { throw refusal(error); }
}
/** Build the single assessment or adjudication mutation with no side effects. */
function apply(state: ScreeningState, input: AssessCandidateInput | ResolveInput, recorder: string) {
  const entry = candidate(state, input.candidate); const vector = normalizeVector(state.definition.protocol, input.vector);
  if ('reviewer' in input) {
    insist(state.protocol_digest === input.protocol_digest, 'protocol_mismatch', 'Assessment protocol differs from the frozen protocol');
    insist(digest(entry.source_ref) === input.source_digest, 'source_mismatch', 'Assessment source differs from the frozen source', 'Use a successor population for changed source versions');
    insist(state.definition.protocol.reviewer_slots.includes(input.reviewer), 'invalid_input', 'Reviewer is not a declared slot');
    const previous = state.assessments.find(a => a.candidate === input.candidate && a.reviewer === input.reviewer);
    insist(previous ? previous.assessment_digest === input.previous_digest && input.amendment_reason !== undefined : input.previous_digest === undefined && input.amendment_reason === undefined, 'assessment_conflict', 'Amendment requires the current assessment digest and an explicit reason', 'Read the current assessment, then submit both previous_digest and amendment_reason');
    const { id: _id, op: _op, revision: _revision, ...assessment } = input;
    const content = { ...assessment, vector, recorder, recorded_at: new Date().toISOString() }; const next = { ...content, assessment_digest: digest(content) };
    state.assessments = state.assessments.filter(a => a !== previous); state.assessments.push(next); return next;
  }
  const assessments = state.assessments.filter(a => a.candidate === input.candidate);
  insist(assessments.length === state.definition.protocol.reviewer_slots.length && canonical(assessments.map(a => a.assessment_digest).sort()) === canonical([...input.assessment_digests].sort()), 'stale_adjudication', 'Resolution must pin every currently declared assessment', 'Collect missing slots or reread amended assessments before adjudicating');
  const next = { candidate: input.candidate, assessment_digests: [...input.assessment_digests].sort(), vector, rationale: input.rationale, recorder, recorded_at: new Date().toISOString() };
  state.adjudications = state.adjudications.filter(a => a.candidate !== input.candidate); state.adjudications.push(next); return next;
}
/** One revision-guarded update and audit comment; stale writes never silently rebase. */
async function mutate(host: Host, input: AssessCandidateInput | ResolveInput, kind: 'assess' | 'resolve', options: OutputOptions): Promise<MutationReceipt> {
  try {
    options = await outputOptions(host, options); const snapshot = await readScreening(host, input.id); await boundary(host, 'after_read');
    const normalized = { ...input, id: snapshot.id, vector: normalizeVector(snapshot.state.definition.protocol, input.vector), ...('assessment_digests' in input ? { assessment_digests: [...input.assessment_digests].sort() } : {}) };
    const previous = replay(snapshot.state, input.op, normalized); if (previous) { preflight(host, snapshot.id, previous, options); return await receipt(host, snapshot.id, previous, true); }
    insist(snapshot.revision === input.revision, 'revision_conflict', 'Caller revision is stale', 'Reread and consciously retry with a reviewed revision');
    const state = structuredClone(snapshot.state); const result = apply(state, normalized, parse(KeySchema, host.author));
    const operation = remember(state, input.op, normalized, kind, input.candidate, result); preflight(host, snapshot.id, operation, options); await boundary(host, 'after_plan');
    await boundary(host, 'before_guard'); await boundary(host, 'before_update');
    const checked = await host.client.withExpectedItemRevisions([{ id: snapshot.id, itemHash: input.revision }], () => host.client.update(snapshot.id, { field: [`screen_state=${canonical(state)}`], comment: [`screen:${kind} explicit judgment; source records unchanged`] }));
    await boundary(host, 'after_update'); insist(checked.checked.includes(snapshot.id) && checked.unchecked.length === 0, 'backend_unsupported', 'Host did not prove the native owner guard', 'Reconcile the original operation key on a conforming host');
    await boundary(host, 'after_guard'); return await receipt(host, snapshot.id, operation, false);
  } catch (error) { throw refusal(error); }
}
/** Submit a complete criterion vector, or explicitly amend an existing slot. */
export async function assessCandidate(host: Host, raw: AssessCandidateInput, options: OutputOptions = {}): Promise<MutationReceipt> { return mutate(host, parse(AssessCandidateInputSchema, raw), 'assess', options); }
/** Record the caller's explicit resolution while retaining opposed judgments. */
export async function resolveScreening(host: Host, raw: ResolveInput, options: OutputOptions = {}): Promise<MutationReceipt> { return mutate(host, parse(ResolveInputSchema, raw), 'resolve', options); }
/** Resolve the common selected-owner read and settings policy once for aggregate views. */
async function aggregateOwner(host: Host, raw: ReportInput, options: OutputOptions) {
  const policy = await outputOptions(host, options); const input = parse(ReportInputSchema, raw);
  return { owner: await readScreening(host, input.id), options: policy };
}
/** Return exact counts and all unresolved identities at one immutable owner revision. */
export async function screeningReport(host: Host, raw: ReportInput, options: OutputOptions = {}) {
  const selected = await aggregateOwner(host, raw, options); const owner = selected.owner; options = selected.options;
  return bounded(host, { owner_id: owner.id, revision: owner.revision, ...deriveScreeningReport(owner.state) }, options);
}
/** Return the next missing or uncertain slot without claiming or allocating it. */
export async function nextScreening(host: Host, raw: NextScreeningInput, options: OutputOptions = {}) {
  options = await outputOptions(host, options); const input = parse(NextScreeningInputSchema, raw); const owner = await readScreening(host, input.id); const protocol = owner.state.definition.protocol;
  insist(protocol.reviewer_slots.includes(input.reviewer), 'invalid_input', 'Reviewer is not a declared slot');
  const next = candidates(owner.state).find(entry => { const assessment = owner.state.assessments.find(a => a.candidate === entry.canonical_candidate_id && a.reviewer === input.reviewer); return !assessment || deriveEligibility(protocol, assessment.vector).unknown_criteria.length > 0; }) ?? null;
  const assessment = owner.state.assessments.find(a => a.candidate === next?.canonical_candidate_id && a.reviewer === input.reviewer);
  return bounded(host, { owner_id: owner.id, revision: owner.revision, reviewer: input.reviewer, candidate: next, missing_criteria: assessment ? deriveEligibility(protocol, assessment.vector).unknown_criteria : next ? protocol.criteria.map(c => c.criterion_id) : [], protocol_digest: owner.state.protocol_digest, source_digest: next ? digest(next.source_ref) : null, allocation: false as const }, options);
}
/** Inspect references only through an explicitly authorized adapter; absence stays unknown. */
export async function checkScreening(host: Host, raw: ReportInput, options: OutputOptions = {}) {
  const { owner, options: policy } = await aggregateOwner(host, raw, options);
  const sources: { candidate: string; status: 'current' | 'changed' | 'missing' | 'inaccessible' | 'unknown' }[] = [];
  for (const entry of candidates(owner.state)) { let status: 'current' | 'changed' | 'missing' | 'inaccessible' | 'unknown'; try { status = await host.inspectSource?.(entry.source_ref) ?? 'unknown'; } catch { status = 'inaccessible'; } sources.push({ candidate: entry.canonical_candidate_id, status }); }
  const current_freshness = (['changed', 'missing', 'inaccessible', 'unknown', 'current'] as const).find(status => sources.some(row => row.status === status))!;
  return bounded(host, { owner_id: owner.id, revision: owner.revision, protocol_digest: owner.state.protocol_digest, population_digest: owner.state.population_digest, source_manifest_digest: owner.state.source_manifest_digest, current_freshness, sources, historical_judgments_unchanged: true as const }, policy);
}
/** Deliver complete candidate witnesses with revision/query-bound omission receipts. */
export async function screeningPacket(host: Host, raw: PacketInput, options: OutputOptions = {}) {
  options = await outputOptions(host, options); const input = parse(PacketInputSchema, raw); const owner = await readScreening(host, input.id);
  const query = digest({ id: owner.id, candidate: input.candidate, limit: input.limit, order: 'canonical-key-v1' }); let offset = 0;
  if (input.cursor !== undefined) {
    let decoded: unknown; try { decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as unknown; } catch { throw new ScreeningRefusal('stale_cursor', 'Cursor is malformed', 'Restart screen packet without a cursor'); }
    insist(decoded !== null && typeof decoded === 'object' && canonical(Object.keys(decoded).sort()) === canonical(['offset', 'query', 'revision']), 'stale_cursor', 'Cursor contract differs', 'Restart screen packet');
    const cursor = decoded as { offset: number; query: string; revision: string };
    insist(cursor.revision === owner.revision && cursor.query === query && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0, 'stale_cursor', 'Cursor revision or query changed', 'Restart screen packet'); offset = cursor.offset;
  }
  const entries = input.candidate === undefined ? candidates(owner.state) : [candidate(owner.state, input.candidate)];
  insist(offset < entries.length, 'stale_cursor', 'Cursor is outside the query', 'Restart screen packet');
  const { unresolved: _unresolved, ...report } = deriveScreeningReport(owner.state);
  // Shrink only complete candidate rows. Counts and reasons are never trimmed.
  for (let size = Math.min(input.limit, entries.length - offset); ; size = Math.max(1, Math.floor(size / 2))) {
    const rows = entries.slice(offset, offset + size).map(entry => ({ entry, decision: disposition(owner.state, entry.canonical_candidate_id) })); const next = offset + rows.length;
    const result = { owner_id: owner.id, revision: owner.revision, report, rows, returned: rows.length, omitted: entries.length - rows.length, remaining: entries.length - next, total: entries.length, next_cursor: next < entries.length ? Buffer.from(canonical({ revision: owner.revision, query, offset: next })).toString('base64url') : null };
    try { return bounded(host, result, options); } catch (error) { if (!(error instanceof ScreeningRefusal) || error.code !== 'output_budget' || size === 1) throw error; }
  }
}
