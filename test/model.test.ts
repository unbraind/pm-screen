import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreening, assessCandidate, resolveScreening, readScreening, screeningReport } from '../dist/index.js';
import type { AssessCandidateInput, Vector } from '../dist/index.js';
import { fixture, definition, request, vector, historyEvents, hasCode } from './helpers.ts';

const eligibility: Record<string, 'included' | 'excluded' | 'uncertain'> = {
  'met/not_met': 'included', 'met/met': 'excluded', 'met/unknown': 'uncertain',
  'not_met/not_met': 'excluded', 'not_met/met': 'excluded', 'not_met/unknown': 'excluded',
  'unknown/not_met': 'uncertain', 'unknown/met': 'excluded', 'unknown/unknown': 'uncertain',
};
/** Independently tabulated expected eligibility on the seeded vector domain. */
export function oracle(values: Vector) { return eligibility[`${values.find(v => v.criterion_id === 'relevant')!.value}/${values.find(v => v.criterion_id === 'release')!.value}`]; }
/** Seeded generator with deterministic high-bit mixing, independent of package code. */
function random(seed: number) { let state = seed >>> 0; return (max: number) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % max; }; }

test('500 seeded operation sequences agree with independent maps and real SDK read-back', async t => {
  const { host, native, birth, pmRoot } = await fixture(t, false); const rand = random(0x51ce2026); const values = ['met', 'not_met', 'unknown'] as const;
  let predecessor: { item_id: string; item_hash: string } | undefined; let sequences = 0; let accepted = 0; let refused = 0; let replays = 0;
  for (let partition = 0; sequences < 500; partition++) {
    const id = `corpus-model-${partition}`; await createScreening(host, { ...birth, ...definition(4, ['first', 'second']), id, ...(predecessor ? { predecessor } : {}) });
    const expected = new Map<string, Vector>(); const resolved = new Map<string, Vector>(); const recorded: AssessCandidateInput[] = []; const originalRevision = (await readScreening(host, id)).revision;
    for (let local = 0; local < 32 && sequences < 500; local++, sequences++) {
      const key = `candidate-${rand(4)}`; const reviewer = rand(2) === 0 ? 'first' : 'second'; const slot = `${key}/${reviewer}`; const operation = rand(6);
      const before = await readScreening(host, id); const history = await historyEvents(pmRoot, id); let changed = false;
      const input = await request(host, id, key, reviewer, `sequence-${sequences}`, vector(values[rand(3)], values[rand(3)]));
      input.vector = input.vector.map(v => ({ ...v, reason: `  ${v.reason}\n  second line  ` }));
      if (operation === 0 || recorded.length === 0) {
        const old = before.state.assessments.find(a => a.candidate === key && a.reviewer === reviewer);
        if (old) { input.previous_digest = old.assessment_digest; input.amendment_reason = '  Explicit model revision  '; }
        await assessCandidate(host, input); expected.set(slot, input.vector.map(v => ({ ...v, reason: v.reason.trim() }))); resolved.delete(key); recorded.push(input); changed = true; accepted++;
      } else if (operation === 1) {
        const old = recorded[rand(recorded.length)]; const normalized = { ...old, id: ` ${id} `, op: ` ${old.op} `, vector: [...old.vector].reverse() };
        const result = await assessCandidate(host, normalized); assert.equal(result.replayed, true); replays++;
      } else if (operation === 2) {
        const old = recorded[rand(recorded.length)]; await assert.rejects(assessCandidate(host, { ...old, vector: vector('unknown', 'unknown') }), hasCode('operation_conflict')); refused++;
      } else if (operation === 3) {
        await assert.rejects(assessCandidate(host, { ...input, revision: originalRevision }), hasCode('revision_conflict')); refused++;
      } else if (operation === 4) {
        const snapshots = before.state.assessments.filter(a => a.candidate === key);
        const resolution = { id, op: input.op, revision: before.revision, candidate: key, assessment_digests: snapshots.length ? snapshots.map(a => a.assessment_digest) : [before.state.protocol_digest], vector: vector(), rationale: 'Seeded explicit adjudication' };
        if (snapshots.length === 2) { await resolveScreening(host, resolution); resolved.set(key, resolution.vector); changed = true; accepted++; }
        else { await assert.rejects(resolveScreening(host, resolution), hasCode('stale_adjudication')); refused++; }
      } else {
        if (expected.has(slot)) { await assert.rejects(assessCandidate(host, input), hasCode('assessment_conflict')); refused++; }
        else { await assessCandidate(host, input); expected.set(slot, input.vector.map(v => ({ ...v, reason: v.reason.trim() }))); recorded.push(input); changed = true; accepted++; }
      }
      const after = await readScreening(host, id); assert.equal(await historyEvents(pmRoot, id), history + Number(changed));
      assert.equal(after.state.assessments.length, expected.size);
      for (const row of after.state.assessments) assert.deepEqual(row.vector, expected.get(`${row.candidate}/${row.reviewer}`)!.toSorted((a, b) => a.criterion_id < b.criterion_id ? -1 : 1));
      const counts = { included: 0, excluded: 0, uncertain: 0, pending: 0, conflict: 0 };
      for (let i = 0; i < 4; i++) {
        const candidate = `candidate-${i}`; const first = expected.get(`${candidate}/first`); const second = expected.get(`${candidate}/second`); const resolution = resolved.get(candidate);
        const stale = after.state.adjudications.some(a => a.candidate === candidate) && !resolution;
        if (!first || !second) counts.pending++;
        else if (resolution) counts[oracle(resolution)]++;
        else if (stale || first.some(v => v.value !== second.find(other => other.criterion_id === v.criterion_id)!.value)) counts.conflict++;
        else counts[oracle(first)]++;
      }
      assert.deepEqual((await screeningReport(host, { id })).counts, counts, `seed sequence ${sequences}`);
      const raw = await native.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' }); assert.ok('item' in raw);
      assert.deepEqual(raw.item.screen_state, after.state); assert.equal((raw.item.dependencies ?? []).some(dep => dep.kind === 'related'), predecessor !== undefined);
    }
    predecessor = { item_id: id, item_hash: (await readScreening(host, id)).revision };
  }
  assert.equal(sequences, 500); t.diagnostic(JSON.stringify({ seed: '51ce2026', sequences, accepted, refused, replays, native_reads_verified: 500, relationships_verified: 500 }));
});
