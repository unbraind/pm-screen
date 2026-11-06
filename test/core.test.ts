import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidate, createScreening, nextScreening, screeningReport, screeningPacket, checkScreening, resolveScreening, readScreening, deriveEligibility, deriveScreeningReport, digest, envelope } from '../dist/index.js';
import { fixture, request, vector, definition, source, hasCode, historyEvents, verifyCriterionOrder } from './helpers.ts';

test('native no-git round trip preserves decisions, exact counts and original replay results', async t => {
  const { host, id, birth, pmRoot } = await fixture(t); const original = await readScreening(host, id);
  assert.equal((await createScreening(host, birth)).replayed, true);
  assert.equal((await screeningReport(host, { id })).counts.pending, 2);
  assert.equal((await nextScreening(host, { id, reviewer: 'first' })).candidate?.canonical_candidate_id, 'candidate-0');
  const input = await request(host, id); const one = await assessCandidate(host, input);
  const two = await assessCandidate(host, await request(host, id, 'candidate-1', 'first', 'other', vector('not_met', 'met')));
  const before = await historyEvents(pmRoot, id); const replay = await assessCandidate(host, input);
  assert.equal(replay.replayed, true); assert.equal(replay.result_digest, one.result_digest); assert.equal(replay.revision, two.revision); assert.equal(await historyEvents(pmRoot, id), before);
  assert.notEqual(original.revision, replay.revision); const report = await screeningReport(host, { id });
  assert.deepEqual(report.counts, { included: 1, excluded: 1, uncertain: 0, pending: 0, conflict: 0 });
  assert.deepEqual(report.primary_reasons, [{ criterion: 'release', count: 1 }]); assert.equal(report.all_witnessed_reasons.length, 2); assert.equal(report.receipt.screening_complete, true);
  assert.equal((await nextScreening(host, { id, reviewer: 'first' })).candidate, null);
  assert.equal((await checkScreening(host, { id })).current_freshness, 'unknown');
  const packet = await screeningPacket(host, { id, limit: 1 }, { budget: 8192 }); assert.equal(packet.returned, 1); assert.equal(packet.omitted, 1);
  const second = await screeningPacket(host, { id, limit: 1, cursor: packet.next_cursor! }, { budget: 8192 }); assert.equal(second.next_cursor, null); assert.equal(second.rows[0].decision.disposition, 'excluded');
  assert.equal(second.remaining, 0); assert.equal(second.omitted, 1); assert.equal(envelope(second).output_complete, false);
  await assert.rejects(screeningPacket(host, { id, limit: 2, cursor: packet.next_cursor! }), hasCode('stale_cursor'));
  const owner = await readScreening(host, id); assert.equal(owner.state.operation_receipts.length, 3);
});

test('criterion identity survives reordered native assessment arrays', verifyCriterionOrder);

test('unknown and inaccessible evidence never create an exclusion; witnessed exclusions retain unknowns', () => {
  const protocol = definition().protocol;
  assert.equal(deriveEligibility(protocol, vector('unknown', 'not_met').map(v => ({ ...v, evidence_refs: [source()] }))).disposition, 'uncertain');
  for (const inclusion of ['met', 'not_met', 'unknown'] as const) for (const exclusion of ['met', 'not_met', 'unknown'] as const) {
    const values = vector(inclusion, exclusion); const result = deriveEligibility(protocol, values);
    const expected = inclusion === 'not_met' || exclusion === 'met' ? 'excluded' : inclusion === 'unknown' || exclusion === 'unknown' ? 'uncertain' : 'included';
    assert.equal(result.disposition, expected);
  }
  assert.equal(deriveEligibility(protocol, vector('not_met', 'met').map(v => ({ ...v, evidence_refs: [] }))).disposition, 'uncertain');
  assert.deepEqual(deriveEligibility(protocol, vector('unknown', 'met')).unknown_criteria, ['relevant']);
  const optional = structuredClone(protocol); optional.criteria.forEach(c => { c.required_evidence = false; });
  assert.equal(deriveEligibility(optional, vector().map(v => ({ ...v, evidence_refs: [] }))).disposition, 'included');
  assert.throws(() => deriveEligibility(protocol, [vector()[0]]), hasCode('missing_criterion'));
});

test('two slots preserve opposed vectors, explicit resolution and stale adjudication after amendment', async t => {
  const { host, id, pmRoot } = await fixture(t, true, definition(1, ['first', 'second']));
  await assessCandidate(host, await request(host, id, 'candidate-0', 'first', 'first', vector('not_met', 'met')));
  assert.equal((await screeningReport(host, { id })).counts.pending, 1);
  await assessCandidate(host, await request(host, id, 'candidate-0', 'second', 'second', vector('met', 'met')));
  assert.equal((await screeningReport(host, { id })).counts.conflict, 1, 'same exclude label cannot hide criterion disagreement');
  let owner = await readScreening(host, id); const resolve = { id, op: 'resolve', revision: owner.revision, candidate: 'candidate-0', assessment_digests: owner.state.assessments.map(a => a.assessment_digest), vector: vector('met', 'met'), rationale: 'Recorded public adjudication' };
  await resolveScreening(host, resolve); assert.equal((await screeningReport(host, { id })).counts.excluded, 1); assert.equal((await resolveScreening(host, resolve)).replayed, true);
  owner = await readScreening(host, id); const previous = owner.state.assessments.find(a => a.reviewer === 'first')!;
  const amendment = { ...await request(host, id, 'candidate-0', 'first', 'amend'), previous_digest: previous.assessment_digest, amendment_reason: 'Reviewed the evidence again' };
  await assessCandidate(host, amendment); assert.equal((await screeningReport(host, { id })).counts.conflict, 1);
  const packet = await screeningPacket(host, { id }, { budget: 8192 }); assert.equal(packet.rows[0].decision.stale_adjudication, true);
  const history = await historyEvents(pmRoot, id);
  await assert.rejects(resolveScreening(host, { ...resolve, op: 'stale', revision: (await readScreening(host, id)).revision }), hasCode('stale_adjudication'));
  assert.equal(await historyEvents(pmRoot, id), history);
  owner = await readScreening(host, id); await resolveScreening(host, { ...resolve, op: 'resolve-again', revision: owner.revision, assessment_digests: owner.state.assessments.map(a => a.assessment_digest) });
  assert.equal((await screeningReport(host, { id })).counts.excluded, 1);
});

test('exact aliases keep imported and unique denominators, and frozen source substitutions refuse', async t => {
  const spec = definition(1); spec.population.entries.push({ ...spec.population.entries[0], entry_id: 'entry-1' }); spec.population.alias_witnesses.push({ entry_id: 'entry-1', canonical_entry_id: 'entry-0', reason: 'Exact artifact identity', evidence_refs: [source()] });
  const { host, id, pmRoot } = await fixture(t, true, spec); const report = await screeningReport(host, { id }); assert.equal(report.imported, 2); assert.equal(report.canonical, 1); assert.equal(report.aliases, 1);
  const input = await request(host, id); const history = await historyEvents(pmRoot, id);
  await assert.rejects(assessCandidate(host, { ...input, source_digest: digest('substitution') }), hasCode('source_mismatch'));
  await assert.rejects(assessCandidate(host, { ...input, protocol_digest: digest('changed protocol') }), hasCode('protocol_mismatch')); assert.equal(await historyEvents(pmRoot, id), history);
  assert.equal(deriveScreeningReport((await readScreening(host, id)).state).receipt.imported_equals_canonical_plus_aliases, true);
});
