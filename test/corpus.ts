import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost, createScreening, readScreening, assessCandidate, screeningReport, screeningPacket, envelope, fitEnvelope, digest, deriveEligibility, deriveScreeningReport, checkScreening } from '../dist/index.js';
import type { SourceRef, Vector, Definition } from '../dist/index.js';
import { wire } from '../dist/src/output.js';
import { guardSubmitted } from '../dist/src/privacy.js';
/** Frozen minimized public judgment fixture, not an independent reviewer claim. */
export interface CorpusRow {
  /** Canonical public candidate identity. */
  id: string;
  /** Bounded public source label. */
  label: string;
  /** Exact source snapshot binding. */
  source_ref: SourceRef;
  /** Original complete candidate bytes before minimized screening. */
  raw_bytes: number;
  /** Explicit submitted ternary judgments and human-readable reason. */
  assessment: { inclusion: 'met' | 'not_met' | 'unknown'; exclusion: 'met' | 'not_met' | 'unknown'; reason: string };
}
/** One declared public evidence-selection question and frame. */
export interface CorpusSet {
  /** Unique fixture partition identity. */
  key: string;
  /** Question known before reviewing candidates. */
  question: string;
  /** Declared inclusion criterion text. */
  inclusion: string;
  /** Declared exclusion criterion text. */
  exclusion: string;
  /** Whether the submitted acquisition frame is declared exhaustive. */
  complete: boolean;
  /** Complete declared population; no judgment removes a row. */
  rows: CorpusRow[];
}
/** Load only committed public fixtures and verify the predeclared policy digest. */
export async function corpus() {
  const fixture = JSON.parse(await readFile('test/fixtures/public-corpus.json', 'utf8')) as { policy_digest: string; sets: CorpusSet[] };
  const policy = await readFile('docs/policy-examples.md', 'utf8'); assert.equal(createHash('sha256').update(policy).digest('hex'), fixture.policy_digest); guardSubmitted(fixture);
  return fixture;
}
/** Translate explicit recorded judgments without calculating expected disposition counts. */
export function submittedVector(row: CorpusRow): Vector {
  return [{ criterion_id: 'include', value: row.assessment.inclusion, evidence_refs: row.assessment.inclusion === 'unknown' ? [] : [row.source_ref], reason: row.assessment.reason }, { criterion_id: 'exclude', value: row.assessment.exclusion, evidence_refs: row.assessment.exclusion === 'unknown' ? [] : [row.source_ref], reason: row.assessment.exclusion === 'met' ? 'The declared exclusion applies to the frozen record.' : 'No witnessed exclusion under the declared rule.' }];
}
/** Create a frozen explicit population using source references rather than source bodies. */
export function definitionFor(set: CorpusSet): Definition {
  return { question: set.question, protocol: { protocol_key: set.key, reviewer_slots: ['recorded-pass'], primary_reason_order: ['exclude', 'include'], criteria: [{ criterion_id: 'include', kind: 'inclusion', text: set.inclusion, required_evidence: true }, { criterion_id: 'exclude', kind: 'exclusion', text: set.exclusion, required_evidence: true }] }, population: { scope_description: `Frozen public ${set.key}; selection query and snapshot receipts are in the public fixture.`, declared_complete: set.complete, acquisition_refs: [set.rows[0].source_ref], entries: set.rows.map(row => ({ entry_id: row.id, canonical_candidate_id: row.id, source_ref: row.source_ref, label: row.label })), alias_witnesses: [] } };
}
/** Independent truth table covers all ternary pairs, without importing production reducers. */
export function expectedEligibility(inclusion: string, exclusion: string): string {
  const table = new Map([['met/not_met', 'included'], ['met/met', 'excluded'], ['met/unknown', 'uncertain'], ['not_met/not_met', 'excluded'], ['not_met/met', 'excluded'], ['not_met/unknown', 'excluded'], ['unknown/not_met', 'uncertain'], ['unknown/met', 'excluded'], ['unknown/unknown', 'uncertain']]);
  const value = table.get(`${inclusion}/${exclusion}`); assert.ok(value); return value;
}
/** Run frozen public judgments through real no-git SDK owners and measure exact output bytes. */
export async function evaluateCorpus(write = false) {
  const input = await corpus(); const expected = JSON.parse(await readFile('test/fixtures/expected-decisions.json', 'utf8')) as { sets: { key: string; included: string[]; excluded: string[]; uncertain: string[]; pending: string[]; conflict: string[] }[] };
  const root = await mkdtemp(join(tmpdir(), 'screen-proof-')); const reports = []; const resumes = [];
  try {
    const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'corpus-recorder', noExtensions: true }); await native.init('proof', { defaults: true, agentGuidance: 'skip', mergeFence: false }); const host = createDirectoryHost(pmRoot, 'corpus-recorder');
    for (const set of input.sets) {
      const definition = definitionFor(set); const id = `proof-${set.key}`; await createScreening(host, { id, op: 'birth', ...definition });
      for (const row of set.rows) {
        const owner = await readScreening(host, id); const vector = submittedVector(row);
        assert.equal(deriveEligibility(definition.protocol, vector).disposition, expectedEligibility(row.assessment.inclusion, row.assessment.exclusion));
        await assessCandidate(host, { id, op: row.id, revision: owner.revision, candidate: row.id, reviewer: 'recorded-pass', protocol_digest: owner.state.protocol_digest, source_digest: digest(row.source_ref), vector });
      }
      const report = await screeningReport(host, { id }, { budget: 8192 }); const gold = expected.sets.find(r => r.key === set.key)!;
      for (const disposition of ['included', 'excluded', 'pending', 'uncertain', 'conflict'] as const) assert.equal(report.counts[disposition], gold[disposition].length);
      let cursor: string | undefined; let packetBytes = 0; let pages = 0; const received: string[] = []; const minBudgets: number[] = [];
      do {
        const page = await screeningPacket(host, { id, cursor }, { budget: 1600 }); const fitted = fitEnvelope(host, envelope(page)); const bytes = Buffer.byteLength(wire(fitted, 'toon')); assert.ok(bytes <= 6400); packetBytes += bytes; pages++;
        for (const row of page.rows) { const key = row.entry.canonical_candidate_id; received.push(key); assert.ok(gold[row.decision.disposition].includes(key)); }
        cursor = page.next_cursor ?? undefined; minBudgets.push(fitted.output_fit.estimated_tokens);
      } while (cursor);
      assert.equal(new Set(received).size, set.rows.length); assert.equal(received.length, set.rows.length);
      const rawBytes = set.rows.reduce((n, row) => n + row.raw_bytes, 0); reports.push({ key: set.key, candidates: set.rows.length, included: report.counts.included, excluded: report.counts.excluded, excluded_by_primary_criterion: report.primary_reasons, unresolved: report.unresolved, counts: report.counts, completeness_receipt: report.receipt, raw_candidate_bytes: rawBytes, raw_estimated_tokens: Math.ceil(rawBytes / 4), all_packet_bytes: packetBytes, all_packet_estimated_tokens: Math.ceil(packetBytes / 4), pages, largest_page_estimated_tokens: Math.max(...minBudgets), independent_review_verified: false });
      if (set.key === 'tracker-items') {
        const selected = [...gold.included, ...gold.uncertain, ...gold.excluded].slice(0, 10);
        for (const key of selected) {
          const row = set.rows.find(r => r.id === key)!; const packet = await screeningPacket(host, { id, candidate: key }); const output = wire(fitEnvelope(host, envelope(packet)), 'toon'); const decision = packet.rows[0].decision;
          assert.equal(decision.assessments[0].vector.find(v => v.criterion_id === 'include')!.reason, row.assessment.reason); assert.deepEqual(packet.report.counts, report.counts);
          assert.ok(Buffer.byteLength(output) <= 6400, 'Resume packet exceeds 1600-token byte budget');
          resumes.push({ question: `What is the decision, reason and complete population count for ${key}?`, candidate: key, disposition: decision.disposition, restored_reason: row.assessment.reason, baseline_bytes: rawBytes + Buffer.byteLength(JSON.stringify(set.rows.map(row => row.assessment))), packet_bytes: Buffer.byteLength(output), identical_counts_and_reason: true });
        }
      }
    }
    const baseline = resumes.reduce((n, row) => n + row.baseline_bytes, 0); const delivered = resumes.reduce((n, row) => n + row.packet_bytes, 0); assert.equal(resumes.length, 10); assert.ok(delivered * 2 <= baseline);
    const result = { schema_version: 1, mechanical_agreement: '87/87 explicit submitted vectors and independent ID decisions', reviewer_agreement: 'Not measured: no independent second reviewer supplied', corpus: reports, resume_questions: resumes, resume_baseline_bytes: baseline, resume_packet_bytes: delivered, resume_reduction_percent: Number((100 * (1 - delivered / baseline)).toFixed(2)) };
    if (write) await writeFile('docs/real-data-receipt.json', JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}
/** Separate synthetic controls cannot inflate the real public candidate counts. */
export async function syntheticControls() {
  const set = (await corpus()).sets.find(s => s.key === 'tracker-items')!; const definition = definitionFor({ ...set, rows: set.rows.slice(0, 10) }); definition.protocol.reviewer_slots = ['first', 'second'];
  for (let i = 0; i < 5; i++) { const entry = definition.population.entries[i]; definition.population.entries.push({ ...entry, entry_id: `zz-alias-${i}` }); definition.population.alias_witnesses.push({ entry_id: `zz-alias-${i}`, canonical_entry_id: entry.entry_id, reason: 'Synthetic exact alias', evidence_refs: [entry.source_ref] }); }
  const root = await mkdtemp(join(tmpdir(), 'screen-controls-')); const pmRoot = join(root, '.agents/pm');
  try {
    const native = new PmClient({ cwd: root, pmRoot, author: 'synthetic', noExtensions: true }); await native.init('controls', { defaults: true, agentGuidance: 'skip', mergeFence: false }); const host = createDirectoryHost(pmRoot, 'synthetic'); const id = 'controls-ledger'; await createScreening(host, { id, op: 'birth', ...definition });
    for (const row of set.rows.slice(0, 10)) for (const reviewer of ['first', 'second']) { const owner = await readScreening(host, id); await assessCandidate(host, { id, op: `${row.id}-${reviewer}`, revision: owner.revision, candidate: row.id, reviewer, protocol_digest: owner.state.protocol_digest, source_digest: digest(row.source_ref), vector: submittedVector(row).map(v => ({ ...v, value: 'unknown', evidence_refs: [], reason: 'Synthetic unavailable source' })) }); }
    const unavailable = deriveScreeningReport((await readScreening(host, id)).state); assert.equal(unavailable.counts.uncertain, 10); assert.equal(unavailable.counts.excluded, 0); assert.equal(unavailable.aliases, 5);
    for (const row of set.rows.slice(0, 3)) { const owner = await readScreening(host, id); const prior = owner.state.assessments.find(a => a.candidate === row.id && a.reviewer === 'second')!; await assessCandidate(host, { id, op: `${row.id}-conflict`, revision: owner.revision, candidate: row.id, reviewer: 'second', protocol_digest: owner.state.protocol_digest, source_digest: digest(row.source_ref), previous_digest: prior.assessment_digest, amendment_reason: 'Synthetic opposed vector', vector: submittedVector(row).map(v => ({ ...v, value: v.criterion_id === 'include' ? 'met' : 'not_met', evidence_refs: [row.source_ref] })) }); }
    const before = await readScreening(host, id); const conflicts = deriveScreeningReport(before.state); assert.equal(conflicts.counts.conflict, 3); assert.equal(conflicts.counts.uncertain, 7);
    let inspected = 0; const fresh = await checkScreening({ ...host, inspectSource: async () => inspected++ === 0 ? 'changed' : 'current' }, { id }); assert.equal(fresh.current_freshness, 'changed');
    assert.deepEqual(await readScreening(host, id), before, 'Freshness inspection must preserve state and revision');
    return { synthetic: true, aliases: 5, unavailable_sources: 10, opposed_vectors: 3, changed_sources: 1, counts_after_disagreement: conflicts.counts, receipt: conflicts.receipt, current_freshness: fresh.current_freshness };
  } finally { await rm(root, { recursive: true, force: true }); }
}
