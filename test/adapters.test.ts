import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createExtensionTestHarness } from '@unbrained/pm-cli/sdk/testing';
import { writeSettingsSection, fitOutputEnvelope, createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import extension, { createScreening, nextScreening, screeningReport, screeningPacket, checkScreening, readScreening, envelope, fitEnvelope } from '../dist/index.js';
import type { ScreeningEnvelope } from '../dist/index.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { refusal } from '../dist/src/errors.js';
import { fixture, definition, source, hasCode } from './helpers.ts';

/** Hash all authoritative native files, excluding native disposable caches and locks. */
async function persistedFiles(pmRoot: string) {
  const files = (await readdir(pmRoot, { recursive: true })).filter(path => /(?:\.toon|\.jsonl|\.json)$/.test(path) && !/^(?:runtime|search|locks|checkpoints|transactions)[/\\]/.test(path)).sort();
  return Promise.all(files.map(async path => [path, await readFile(join(pmRoot, path), 'utf8')]));
}

test('read-only SDK operations preserve all authoritative files and settings', async t => {
  const { host, id, pmRoot } = await fixture(t); const before = await persistedFiles(pmRoot);
  await nextScreening(host, { id, reviewer: 'first' }); await screeningReport(host, { id }); await screeningPacket(host, { id }); await checkScreening(host, { id }); await readScreening(host, id);
  assert.deepEqual(await persistedFiles(pmRoot), before);
});

test('native extension settings and SDK budget policy share validated precedence', async t => {
  const { host, id, pmRoot } = await fixture(t); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  /** Actual native dispatch sees the persisted settings section. */
  const report = async () => (await ext.runCommand({ command: 'screen report', args: [id], options: {}, global: { author: 'fixture' }, pmRoot })).result as ScreeningEnvelope;
  for (const value of [null, [], 'invalid', { unknown: true }, { output_budget: '1600' }, { output_budget: 0 }]) { await writeSettingsSection(pmRoot, 'screen', value, { author: 'fixture' }); assert.equal((await report()).refusal?.code, 'invalid_record'); await assert.rejects(screeningReport(host, { id }), hasCode('invalid_record')); }
  await writeSettingsSection(pmRoot, 'screen', { output_budget: 1 }, { author: 'fixture' }); assert.equal((await report()).refusal?.code, 'output_budget'); await assert.rejects(screeningReport(host, { id }), hasCode('output_budget'));
  assert.equal((await screeningReport(host, { id }, { budget: 1600 })).canonical, 2);
  await writeSettingsSection(pmRoot, 'screen', { output_budget: 1600 }, { author: 'fixture' }); assert.equal((await report()).ok, true);
  await writeSettingsSection(pmRoot, 'screen', undefined, { author: 'fixture' }); assert.equal((await report()).ok, true);
});

test('unprovisioned harness reads preserve schema and native adapter passthrough', async t => {
  const { pmRoot, native, host } = await fixture(t, false); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  const before = await native.schemaListFields();
  const result = await ext.runCommand({ command: 'screen report', args: ['corpus-absent'], options: {}, global: { author: 'fixture' }, pmRoot }); assert.equal((result.result as ScreeningEnvelope).refusal?.code, 'not_found');
  assert.deepEqual((await native.schemaListFields()).fields, before.fields);
  // Registration-only harnesses do not install schema into a separate client; packed acceptance covers actual installation.
  const port = persistedSchemaPort(native, true); await port.create({ id: 'corpus-task', type: 'Task', title: 'Unrelated native item' });
  await persistedSchemaPort(native).update('corpus-task'); assert.equal(await host.settings!(), undefined);
});

test('multiple evidence and alias references normalize deterministically without changing scope claims', async t => {
  const spec = definition(1); spec.population.declared_complete = false; spec.population.acquisition_refs = [source('z'), source('a')];
  for (const suffix of ['z', 'y']) { spec.population.entries.push({ ...spec.population.entries[0], entry_id: `entry-${suffix}` }); spec.population.alias_witnesses.push({ entry_id: `entry-${suffix}`, canonical_entry_id: 'entry-0', reason: 'Exact duplicate', evidence_refs: [source('z'), source('a')] }); }
  const { host, id } = await fixture(t, true, spec); const report = await screeningReport(host, { id }); assert.equal(report.source_completeness, 'declared_partial'); assert.equal(report.aliases, 2);
});

test('real native fitter failures and dishonest estimator adapters fail safely', async t => {
  const { host, id } = await fixture(t); const value = envelope(await screeningPacket(host, { id }));
  const rendererFailure = new Error('Synthetic renderer failure');
  const failedRenderer: typeof fitOutputEnvelope = (rows, options) => fitOutputEnvelope(rows, { ...options, renderers: { broken: () => { throw rendererFailure; } } });
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: failedRenderer }, value), error => error === rendererFailure);
  let calls = 0; const failsAfterMinimum: typeof fitOutputEnvelope = (rows, options) => ++calls === 1 ? fitOutputEnvelope(rows, options) : failedRenderer(rows, options);
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: failsAfterMinimum }, value, 1), error => error === rendererFailure);
  const workLimited: typeof fitOutputEnvelope = (rows, options) => fitOutputEnvelope(rows, { ...options, maxRenderCalls: 1 });
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: workLimited }, value), hasCode('backend_unsupported'));
  const fixedBudget: typeof fitOutputEnvelope = (rows, options) => fitOutputEnvelope(rows, { ...options, tokenBudget: 1 });
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: fixedBudget }, value, 1), hasCode('backend_unsupported'));
  const undercount: typeof fitOutputEnvelope = (rows, options) => fitOutputEnvelope(rows, { ...options, estimateTokens: () => 1 });
  const oversized = { ...value, warnings: Array.from({ length: 500 }, () => 'x'.repeat(100)) };
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: undercount }, oversized), hasCode('output_budget'));
  assert.throws(() => fitEnvelope(host, oversized, 8192), hasCode('output_budget'));
  assert.throws(() => fitEnvelope(host, { ...value, warnings: ['ghp_' + 'A'.repeat(36)] }), hasCode('invalid_input'));
  const coded = createPmCliExpectedError('Unsafe submitted failure', { context: { code: 'permission_denied', required: 'Unsafe remedy text' }, exitCode: 5 });
  assert.equal(refusal(coded).code, 'permission_denied'); assert.ok(!refusal(coded).remedy.includes('Unsafe'));
  assert.equal(refusal(createPmCliExpectedError('No stable category')).code, 'outcome_unknown');
});
