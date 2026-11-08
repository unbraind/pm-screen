import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreening, assessCandidate, resolveScreening, readScreening } from '../dist/index.js';
import { fixture, request, hasCode, vector, historyEvents } from './helpers.ts';

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
