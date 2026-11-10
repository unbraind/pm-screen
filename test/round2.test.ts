import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import extension, { assessCandidate, createScreening, resolveScreening, nextScreening, readScreening, envelope, fitEnvelope } from '../dist/index.js';
import type { ScreeningEnvelope } from '../dist/index.js';
import { guardSubmitted } from '../dist/src/privacy.js';
import { wire } from '../dist/src/output.js';
import { fixture, definition, request, vector, historyEvents, resolutionRequest } from './helpers.ts';

test('next work reaches every untouched candidate before uncertain retries for each reviewer and output', async t => {
  const spec = definition(3, ['first', 'second']);
  spec.population.entries.reverse();
  const { host, id, pmRoot } = await fixture(t, true, spec);
  const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  for (const reviewer of ['first', 'second']) {
    for (let i = 0; i < 3; i++) {
      const before = await historyEvents(pmRoot, id);
      const next = await nextScreening(host, { id, reviewer });
      assert.equal(next.candidate?.canonical_candidate_id, `candidate-${i}`, 'Untouched work must precede uncertain retries');
      const cli = (await ext.runCommand({ command: 'screen next', args: [id], options: { reviewer }, global: { author: 'fixture' }, pmRoot })).result as ScreeningEnvelope;
      assert.deepEqual(cli, fitEnvelope(host, envelope(next))); assert.deepEqual(JSON.parse(wire(cli, 'json')), decodeToon(wire(cli, 'toon')));
      assert.equal(await historyEvents(pmRoot, id), before);
      await assessCandidate(host, await request(host, id, `candidate-${i}`, reviewer, `unknown-${i}-${reviewer}`, vector('unknown', 'not_met')));
    }
    assert.equal((await nextScreening(host, { id, reviewer })).candidate?.canonical_candidate_id, 'candidate-0', 'Retry uncertain work only after all untouched work');
    for (let i = 0; i < 3; i++) {
      const owner = await readScreening(host, id); const prior = owner.state.assessments.find(row => row.candidate === `candidate-${i}` && row.reviewer === reviewer)!;
      await assessCandidate(host, { ...await request(host, id, `candidate-${i}`, reviewer, `complete-${i}-${reviewer}`), previous_digest: prior.assessment_digest, amendment_reason: 'Evidence is now available' });
    }
    assert.equal((await nextScreening(host, { id, reviewer })).candidate, null);
  }
});

test('aggregate node scanning bounds shared graphs and primitive arrays before every mutation effect', async t => {
  const { host, id, birth, pmRoot } = await fixture(t);
  const before = await readScreening(host, id); const history = await historyEvents(pmRoot, id);
  const leaf = {}; const allowed = Array.from({ length: 100 }, () => leaf); guardSubmitted(allowed);
  guardSubmitted(Array.from({ length: 262143 }, () => null));
  let dag: unknown = leaf;
  for (let i = 0; i < 4; i++) dag = Array.from({ length: 24 }, () => dag);
  // Objects never take the up-front array-length charge, so only the per-visit budget bounds a shared object graph.
  let objects: unknown = leaf;
  for (let i = 0; i < 4; i++) { const child = objects; objects = Object.fromEntries(Array.from({ length: 24 }, (_, key) => [`k${key}`, child])); }
  const assessment = await request(host, id); const resolution = await resolutionRequest(host, id);
  for (const extra of [dag, objects, Array.from({ length: 262144 }, () => null)]) {
    assert.throws(() => guardSubmitted(extra), /Aggregate node scanning budget exceeded/, 'Every graph visit must consume a finite budget');
    await assert.rejects(createScreening(host, Object.assign({ ...birth, id: 'corpus-refused' }, { extra })), /Aggregate node scanning budget exceeded/);
    await assert.rejects(assessCandidate(host, Object.assign({ ...assessment }, { extra })), /Aggregate node scanning budget exceeded/);
    await assert.rejects(resolveScreening(host, Object.assign({ ...resolution }, { extra })), /Aggregate node scanning budget exceeded/);
  }
  assert.deepEqual(await readScreening(host, id), before); assert.equal(await historyEvents(pmRoot, id), history);
});
