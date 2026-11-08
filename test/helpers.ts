import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import assert from 'node:assert/strict';
import { createDirectoryHost, createScreening, readScreening, assessCandidate, screeningReport, canonical, digest } from '../dist/index.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import type { Host, Definition, Vector, AssessCandidateInput } from '../dist/index.js';
import type { TestContext } from 'node:test';
/** Deterministic public artifact binding; tests never retrieve it. */
export function source(key = 'public') { return { public_uri: `https://example.org/${key}`, content_digest: digest(key) }; }
/** Small frozen frame with one inclusion and one exclusion. */
export function definition(size = 2, slots = ['first']): Definition {
  return { question: 'Which records describe lost context?', protocol: { protocol_key: 'context', criteria: [{ criterion_id: 'relevant', kind: 'inclusion', text: 'Describes context loss', required_evidence: true }, { criterion_id: 'release', kind: 'exclusion', text: 'Only a release scheduling request', required_evidence: true }], reviewer_slots: slots, primary_reason_order: ['release', 'relevant'] }, population: { scope_description: 'Explicit public test frame', acquisition_refs: [source()], declared_complete: true, entries: Array.from({ length: size }, (_, i) => ({ entry_id: `entry-${i}`, canonical_candidate_id: `candidate-${i}`, source_ref: source(`source-${i}`), label: `Public candidate ${i}` })), alias_witnesses: [] } };
}
/** Complete independent slot vector in declared criterion order. */
export function vector(inclusion: 'met' | 'not_met' | 'unknown' = 'met', exclusion: 'met' | 'not_met' | 'unknown' = 'not_met'): Vector {
  return [{ criterion_id: 'relevant', value: inclusion, evidence_refs: inclusion === 'unknown' ? [] : [source()], reason: `Relevance ${inclusion}` }, { criterion_id: 'release', value: exclusion, evidence_refs: exclusion === 'unknown' ? [] : [source()], reason: `Release ${exclusion}` }];
}
/** Real SDK tracker outside Git, with cleanup registered before initialization. */
export async function fixture(t: TestContext, provision = true, spec = definition()) {
  const root = await mkdtemp(join(tmpdir(), 'pm-screen-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'fixture', noExtensions: true });
  await native.init('corpus', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const host = createDirectoryHost(pmRoot, 'fixture'); const birth = { id: 'corpus-ledger', op: 'birth', ...spec };
  if (provision) await createScreening(host, birth); return { root, pmRoot, native, host, birth, id: birth.id };
}
/** Prepare a fresh explicit request with exact frozen source and protocol identities. */
export async function request(host: Host, id: string, key = 'candidate-0', reviewer = 'first', op = `assess-${key}-${reviewer}`, values = vector()): Promise<AssessCandidateInput> {
  const current = await readScreening(host, id); const entry = current.state.definition.population.entries.find(e => e.canonical_candidate_id === key)!;
  return { id, op, revision: current.revision, candidate: key, reviewer, protocol_digest: current.state.protocol_digest, source_digest: digest(entry.source_ref), vector: values };
}
/** Match stable domain refusal without exposing submitted data. */
export function hasCode(code: string): (error: unknown) => boolean { return error => typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
/** Count native audit events for exact once/rejected-write assertions. */
export async function historyEvents(pmRoot: string, id: string): Promise<number> { return (await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8')).trim().split('\n').length; }
/** A native SDK round trip may preserve equivalent vectors in different array order. */
export async function verifyCriterionOrder(t: TestContext): Promise<void> {
  const { host, id, native } = await fixture(t, true, definition(1, ['first', 'second']));
  for (const reviewer of ['first', 'second']) await assessCandidate(host, await request(host, id, 'candidate-0', reviewer));
  const state = (await readScreening(host, id)).state;
  const { assessment_digest: _original, ...content } = state.assessments[1]; content.vector.reverse();
  state.assessments[1] = { ...content, assessment_digest: digest(content) };
  await persistedSchemaPort(native).update(id, { field: [`screen_state=${canonical(state)}`] });
  const report = await screeningReport(host, { id }); assert.equal(report.counts.included, 1); assert.equal(report.counts.conflict, 0);
}

/** Prepare an adjudication request from the complete current native assessment set. */
export async function resolutionRequest(host: Host, id: string) {
  const current = await readScreening(host, id);
  return { vector: vector(), rationale: 'Reviewed', assessment_digests: current.state.assessments.map(row => row.assessment_digest), candidate: 'candidate-0', id, op: 'resolve', revision: current.revision };
}
