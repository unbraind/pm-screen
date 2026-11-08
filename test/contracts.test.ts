import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import extension, { assessCandidate, readScreening, screeningPacket, envelope, fitEnvelope, ScreeningRefusal, ScreeningEnvelopeSchema } from '../dist/index.js';
import type { ScreeningEnvelope } from '../dist/index.js';
import { runCommand, inputJson } from '../dist/src/commands.js';
import { refusalEnvelope, wire, renderOutput } from '../dist/src/output.js';
import { fixture, request, definition, vector, hasCode } from './helpers.ts';

test('real extension harness executes all seven commands and preserves strict JSON TOON parity', async t => {
  const { pmRoot, host, native } = await fixture(t); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  for (const name of ['create', 'next', 'assess', 'resolve', 'report', 'check', 'packet']) ext.assertCommandContract({ command: `screen ${name}` });
  ext.assertItemField({ name: 'screen_state', type: 'object' }); ext.assertItemType({ name: 'Screening', folder: 'screenings' });
  /** Run through the native extension dispatch with a real tracker. */
  const run = async (command: string, args: string[] = [], options: Record<string, unknown> = {}, global: Record<string, unknown> = {}) => {
    const result = await ext.runCommand({ command: `screen ${command}`, args, options, global: { author: 'fixture', ...global }, pmRoot }); if (result.cause) throw result.cause; assert.equal(result.handled, true); return result.result as ScreeningEnvelope;
  };
  const birth = await run('create', [], { id: 'corpus-cli', op: 'birth', input: JSON.stringify(definition(2)) }); assert.equal(birth.ok, true, JSON.stringify(birth));
  assert.equal((await run('next', ['corpus-cli'], { reviewer: 'first' })).ok, true);
  const { id: _id, op, revision, ...assessment } = await request(host, 'corpus-cli');
  const first = await run('assess', ['corpus-cli'], { op, revision, input: JSON.stringify(assessment) }); assert.equal(first.ok, true);
  const owner = await readScreening(host, 'corpus-cli');
  const resolved = await run('resolve', ['corpus-cli'], { op: 'resolve', revision: first.revision, candidate: 'candidate-0', input: JSON.stringify({ assessment_digests: owner.state.assessments.map(a => a.assessment_digest), vector: vector(), rationale: 'Explicit recorded decision' }) }); assert.equal(resolved.ok, true);
  for (const command of ['report', 'check', 'packet']) assert.equal((await run(command, ['corpus-cli'], { budget: '8192' })).ok, true);
  const packet = await run('packet', ['corpus-cli'], { limit: '1', budget: '8192' }); assert.ok(packet.next_cursor);
  assert.equal((await run('packet', ['corpus-cli'], { limit: '1', cursor: packet.next_cursor, budget: '8192' })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { limit: '1' }, { outputCursor: packet.next_cursor, outputBudget: 'unbounded' })).ok, true);
  for (const format of ['json', 'toon'] as const) { ext.assertRendererOverride({ format }); const output = await ext.runRendererOverride({ format, command: 'screen packet', result: packet }); assert.deepEqual(format === 'json' ? JSON.parse(String(output.rendered)) : decodeToon(String(output.rendered)), packet); }
  for (const [command, options, global, expected] of [
    ['assess', { op: 'stale', revision: birth.revision, input: JSON.stringify(assessment) }, {}, 'revision_conflict'],
    ['assess', { op: 'empty', revision: '', input: '{}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'bad', input: '{"id":"other"}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'tiny', input: JSON.stringify(definition()) }, { outputBudget: '1' }, 'output_budget'],
    ['resolve', { op: 'bad', revision: first.revision, candidate: 'candidate-0', input: '{"candidate":"other"}' }, {}, 'invalid_input'],
    ['packet', { limit: '1.5' }, {}, 'invalid_input'], ['packet', { limit: '101' }, {}, 'invalid_input'], ['packet', {}, { outputBudget: 0 }, 'invalid_input'], ['packet', {}, { outputBudget: [] }, 'invalid_input'], ['packet', {}, { outputBudget: '99999999999999999999' }, 'invalid_input'],
    ['packet', { candidate: [] }, {}, 'invalid_input'], ['packet', {}, { outputInclude: 'id' }, 'invalid_input'], ['packet', {}, { outputSession: 'x' }, 'invalid_input'], ['packet', {}, { outputRowContract: 'x' }, 'invalid_input'],
    ['report', {}, { outputCursor: 'bad' }, 'invalid_input'], ['report', {}, { outputLimit: 1 }, 'invalid_input'],
    ['packet', { cursor: packet.next_cursor }, { outputCursor: packet.next_cursor }, 'invalid_input'],
    ['packet', { limit: '1' }, { outputLimit: '1' }, 'invalid_input'], ['packet', { budget: '1600' }, { outputBudget: '1600' }, 'invalid_input'],
  ] as const) { const failed = await run(command, ['corpus-cli'], options, global); assert.equal(failed.refusal?.code, expected, JSON.stringify(failed)); }
  assert.equal((await run('packet', ['corpus-cli'], {}, { outputLimit: '1', outputBudget: '8192' })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { candidate: 'candidate-1' })).ok, true);
  await assert.rejects(native.get('corpus-refused'));
  const missing = await runCommand('packet', { command: 'screen packet', args: [], options: {}, global: {}, pm_root: pmRoot } as CommandHandlerContext) as ScreeningEnvelope; assert.equal(missing.refusal?.code, 'backend_unsupported');
});

test('strict stdin refuses malformed UTF-8, arrays and oversized JSON', async () => {
  /** Stream deterministic input bytes without filesystem reads. */
  async function* stream(bytes: Uint8Array) { yield bytes; }
  assert.deepEqual(await inputJson('-', stream(Buffer.from('{"text":"é"}'))), { text: 'é' });
  for (const value of ['{', '[]', 'null', '"text"', 'x'.repeat(262145)]) await assert.rejects(inputJson(value), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.from([0xff]))), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.alloc(262145))), hasCode('invalid_input'));
});

test('packet cursors pin revision and query while complete rows shrink to fit', async t => {
  const { host, id } = await fixture(t, true, definition(12));
  const first = await screeningPacket(host, { id, limit: 1 }); assert.ok(first.next_cursor);
  const next = await screeningPacket(host, { id, limit: 1, cursor: first.next_cursor }); assert.equal(next.rows[0].entry.canonical_candidate_id, 'candidate-1');
  for (const cursor of ['bad', Buffer.from('null').toString('base64url'), Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ offset: -1, query: 'x', revision: first.revision })).toString('base64url')]) await assert.rejects(screeningPacket(host, { id, cursor }), hasCode('stale_cursor'));
  const decoded = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString('utf8')); decoded.offset = 100;
  await assert.rejects(screeningPacket(host, { id, limit: 1, cursor: Buffer.from(JSON.stringify(decoded)).toString('base64url') }), hasCode('stale_cursor'));
  await assessCandidate(host, await request(host, id)); await assert.rejects(screeningPacket(host, { id, limit: 1, cursor: first.next_cursor }), hasCode('stale_cursor'));
  const fitted = await screeningPacket(host, { id }); assert.ok(fitted.returned < 12); assert.equal(fitted.report.canonical, 12); assert.equal(fitted.returned + fitted.omitted, 12);
  assert.equal((await screeningPacket(host, { id, candidate: 'candidate-1' })).rows.length, 1);
  await assert.rejects(screeningPacket(host, { id }, { budget: 1 }), hasCode('output_budget'));
});

test('whole-envelope measurement, retry minimum and strict semantic parity include framing', async t => {
  const { host, id } = await fixture(t); const value = envelope(await screeningPacket(host, { id }));
  assert.equal(ScreeningEnvelopeSchema.safeParse(value).success, true);
  assert.equal(ScreeningEnvelopeSchema.safeParse({ ...value, data: undefined }).success, false);
  assert.equal(ScreeningEnvelopeSchema.safeParse(refusalEnvelope(new ScreeningRefusal('invalid_input', 'Safe refusal'))).success, true);
  const result = fitEnvelope(host, value); assert.ok(result.output_fit.estimated_tokens <= 1600);
  for (const format of ['json', 'toon'] as const) assert.ok(Math.ceil(Buffer.byteLength(wire(result, format)) / 4) <= 1600);
  assert.throws(() => fitEnvelope(host, value, 0), hasCode('invalid_input'));
  let minimum = 0; try { fitEnvelope({}, value, 1); } catch (error) { assert.ok(error instanceof ScreeningRefusal); minimum = error.details.minimum_usable_budget as number; }
  assert.ok(minimum > 1); assert.ok(fitEnvelope({}, value, minimum).output_fit.estimated_tokens <= minimum);
  assert.throws(() => fitEnvelope(host, { ...value, warnings: Array.from({ length: 500 }, () => 'x'.repeat(100)) }, 8192), hasCode('output_budget'));
  assert.equal(refusalEnvelope(new ScreeningRefusal('not_found', 'Missing')).exit_code, 3);
  assert.deepEqual(JSON.parse(wire(result, 'json')), decodeToon(wire(result, 'toon')));
  for (const bad of [{ output_budget_exceeded: true }, { read_output: { strings_compacted: true } }, { read_output: { rows_compacted: true } }, { read_output: { result_omitted: true } }, { data: 'x'.repeat(40000) }]) assert.equal(JSON.parse(renderOutput(bad, 'json')).refusal.code, 'output_budget');
  assert.equal(renderOutput(null, 'json'), 'null\n'); assert.equal(renderOutput('safe', 'json'), '"safe"\n');
});
