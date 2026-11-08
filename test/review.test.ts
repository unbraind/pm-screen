import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { ScreeningEnvelope } from '../dist/index.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { normalizeVector } from '../dist/src/kernel.js';
import { wire } from '../dist/src/output.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import extension, { createScreening, assessCandidate, resolveScreening, readScreening, nextScreening, screeningReport, screeningPacket, checkScreening, readState, deriveEligibility, digest, canonical, envelope, fitEnvelope } from '../dist/index.js';
import { fixture, request, hasCode, vector, historyEvents, resolutionRequest } from './helpers.ts';

test('malformed public URIs refuse as invalid input before any native create effect', async t => {
  const { host, birth, native } = await fixture(t, false);
  for (const public_uri of ['https://', 'https://[', 'https://example.org:invalid/', 'https://user:password@example.org/artifact']) {
    const entries = [{ ...birth.population.entries[0], source_ref: { ...birth.population.entries[0].source_ref, public_uri } }];
    await assert.rejects(createScreening(host, { ...birth, population: { ...birth.population, entries } }), hasCode('invalid_input'));
    await assert.rejects(native.get(birth.id));
  }
});

test('recorder key refusal explains compatible attribution for assessment and resolution without writes', async t => {
  const { host, id, pmRoot } = await fixture(t);
  const bad = { ...host, author: 'Jane Doe' }; const input = await request(host, id); const before = await historyEvents(pmRoot, id);
  /** Check the public diagnostic without depending on a reflected author string. */
  const diagnostic = (error: unknown): boolean => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 'invalid_input' && 'remedy' in error);
    assert.match(error.message, /Recorder attribution/); assert.match(String(error.remedy), /Select an author key/); assert.doesNotMatch(error.message + error.remedy, /Jane Doe/); return true;
  };
  await assert.rejects(assessCandidate(bad, input), diagnostic); assert.equal(await historyEvents(pmRoot, id), before);
  const accepted = { ...host, author: '  public-recorder:1  ' }; await assessCandidate(accepted, input);
  const owner = await readScreening(host, id); assert.equal(owner.state.assessments[0].recorder, 'public-recorder:1');
  const resolution = { id, op: 'resolve', revision: owner.revision, candidate: 'candidate-0', assessment_digests: owner.state.assessments.map(a => a.assessment_digest), vector: vector(), rationale: 'Reviewed public evidence' };
  const recorded = await historyEvents(pmRoot, id); await assert.rejects(resolveScreening(bad, resolution), diagnostic); assert.equal(await historyEvents(pmRoot, id), recorded);
  assert.equal((await assessCandidate(bad, input)).replayed, true);
  await resolveScreening(host, resolution); assert.equal((await readScreening(host, id)).state.adjudications[0].recorder, 'fixture');
});

test('stored legacy text remains readable evaluable and exportable through every SDK and CLI view', async t => {
  const { host, id, native, pmRoot } = await fixture(t);
  await assessCandidate(host, await request(host, id, 'candidate-0', 'first', 'unknown', vector('unknown', 'not_met')));
  await resolveScreening(host, await resolutionRequest(host, id));
  await assessCandidate(host, await request(host, id, 'candidate-1', 'first', 'known-second'));
  const owner = await readScreening(host, id); const state = owner.state;
  state.definition.protocol.criteria[0].text = 'Review $HOME...';
  state.protocol_digest = digest(state.definition.protocol);
  state.operation_receipts[0].result.digest = digest(state.definition);
  state.operation_receipts[0].result_digest = digest(state.operation_receipts[0].result);
  for (const assessment of state.assessments) {
    assessment.protocol_digest = state.protocol_digest; assessment.vector[0].reason = 'Legacy ~/. evidence';
    const { assessment_digest: _old, ...content } = assessment; assessment.assessment_digest = digest(content);
  }
  state.adjudications[0].assessment_digests = state.assessments.filter(a => a.candidate === 'candidate-0').map(a => a.assessment_digest); state.adjudications[0].vector[0].reason = 'Legacy %USERPROFILE%...';
  await persistedSchemaPort(native).update(id, { field: [`screen_state=${canonical(state)}`] });
  const before = await readScreening(host, id); const history = await historyEvents(pmRoot, id);
  assert.deepEqual(readState(state), state, 'Stored records must use stored validation');
  assert.throws(() => deriveEligibility(state.definition.protocol, state.assessments[0].vector), hasCode('invalid_input'));
  assert.throws(() => normalizeVector(state.definition.protocol, state.assessments[0].vector), hasCode('invalid_input'));
  const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  await nextScreening(host, { id, reviewer: 'first' }); await checkScreening(host, { id });
  for (const data of [await screeningReport(host, { id }), await screeningPacket(host, { id }, { budget: 8192 })]) {
    const fitted = fitEnvelope(host, envelope(data), 8192); assert.deepEqual(JSON.parse(wire(fitted, 'json')), decodeToon(wire(fitted, 'toon')), 'Legacy output parity');
  }
  for (const command of ['next', 'report', 'packet', 'check']) {
    const result = await ext.runCommand({ command: `screen ${command}`, args: [id], options: { reviewer: 'first', budget: '8192' }, global: { author: 'fixture' }, pmRoot });
    assert.equal((result.result as ScreeningEnvelope).ok, true, `Stored CLI ${command} must remain readable`);
  }
  assert.deepEqual(await readScreening(host, id), before); assert.equal(await historyEvents(pmRoot, id), history);
});
