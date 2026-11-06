import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreening, createDirectoryHost, assessCandidate, readScreening, resolveScreening, screeningReport, deriveEligibility } from '../dist/index.js';
import { renderOutput } from '../dist/src/output.js';
import { fixture, request, definition, vector, source, hasCode, historyEvents, verifyCriterionOrder } from './helpers.ts';

test('revert criterion identity compares values by key', verifyCriterionOrder);

test('revert eligibility keeps missing evidence unknown', () => {
  const protocol = definition().protocol;
  const unknownWithEvidence = vector('unknown', 'not_met'); unknownWithEvidence[0].evidence_refs = [source()];
  assert.deepEqual(deriveEligibility(protocol, unknownWithEvidence).unknown_criteria, ['relevant']);
  assert.equal(deriveEligibility(protocol, vector('not_met', 'met').map(v => ({ ...v, evidence_refs: [] }))).disposition, 'uncertain');
  assert.equal(deriveEligibility(protocol, vector('unknown', 'not_met')).disposition, 'uncertain');
});

test('revert native CAS prevents loss at the final pre-update boundary', async t => {
  const { host, id, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id);
  host.boundary = async step => { if (step === 'before_update') await assessCandidate(peer, await request(peer, id, 'candidate-1')); };
  await assert.rejects(assessCandidate(host, input), hasCode('revision_conflict')); assert.equal((await readScreening(peer, id)).state.assessments[0].candidate, 'candidate-1'); assert.equal(await historyEvents(pmRoot, id), 2);
});

test('revert original request replay bypasses only its obsolete revision', async t => {
  const { host, id, pmRoot } = await fixture(t); const input = await request(host, id); await assessCandidate(host, input); await assessCandidate(host, await request(host, id, 'candidate-1'));
  const before = await historyEvents(pmRoot, id); assert.equal((await assessCandidate(host, input)).replayed, true); assert.equal(await historyEvents(pmRoot, id), before);
});

test('revert criterion conflicts and stale adjudications remain unresolved', async t => {
  const { host, id } = await fixture(t, true, definition(1, ['first', 'second']));
  await assessCandidate(host, await request(host, id, 'candidate-0', 'first', 'first', vector('met', 'met')));
  await assessCandidate(host, await request(host, id, 'candidate-0', 'second', 'second', vector('not_met', 'met')));
  assert.equal((await screeningReport(host, { id })).counts.conflict, 1); let owner = await readScreening(host, id);
  await resolveScreening(host, { id, op: 'resolve', revision: owner.revision, candidate: 'candidate-0', assessment_digests: owner.state.assessments.map(a => a.assessment_digest), vector: vector(), rationale: 'Reviewed resolution' });
  owner = await readScreening(host, id); await assessCandidate(host, { ...await request(host, id, 'candidate-0', 'first', 'amend'), previous_digest: owner.state.assessments.find(a => a.reviewer === 'first')!.assessment_digest, amendment_reason: 'Explicit amendment' });
  assert.equal((await screeningReport(host, { id })).counts.conflict, 1);
});

test('revert write budget fails before any domain or audit effect', async t => {
  const { host, id, pmRoot } = await fixture(t); const before = await historyEvents(pmRoot, id);
  await assert.rejects(assessCandidate(host, await request(host, id), { budget: 1 }), hasCode('output_budget')); assert.equal(await historyEvents(pmRoot, id), before);
});

test('revert alias witness cannot merge different exact source contents', async t => {
  const { host, birth } = await fixture(t, false); const spec = definition(); spec.population.entries[1].canonical_candidate_id = 'candidate-0'; spec.population.alias_witnesses = [{ entry_id: 'entry-1', canonical_entry_id: 'entry-0', reason: 'Unproven alias', evidence_refs: [source()] }];
  await assert.rejects(createScreening(host, { ...birth, ...spec }), hasCode('invalid_alias'));
});

test('revert host compaction cannot claim a complete screening witness', () => {
  assert.equal(JSON.parse(renderOutput({ read_output: { strings_compacted: true }, ok: true }, 'json')).refusal.code, 'output_budget');
});
