import test from 'node:test';
import assert from 'node:assert/strict';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createScreening, assessCandidate, readScreening, screeningReport, nextScreening, checkScreening, readState, digest, canonical, ScreeningRefusal, exitCode } from '../dist/index.js';
import type { CreateScreeningInput, ScreeningState, Host } from '../dist/index.js';
import { guardSubmitted } from '../dist/src/privacy.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { refusal, insist } from '../dist/src/errors.js';
import { normalizeDefinition, compare } from '../dist/src/kernel.js';
import { fixture, request, definition, vector, source, hasCode, historyEvents } from './helpers.ts';

test('strict privacy refusals have zero effects while inert text and Unicode round trip', async t => {
  const { host, birth, native, id } = await fixture(t, false);
  const homePath = '/' + ['home', 'example', 'secret'].join('/');
  const forbidden = ['\u001b[31m', '\u202eevil', '\ud800', homePath, '/' + ['Users', 'example'].join('/'), '/' + 'root/file', 'x'.repeat(8001), 'ghp_' + 'A'.repeat(36), 'person' + '@example.org', 'file://' + homePath, 'see https://example.org/page and ' + homePath, 'https://example.org/reset?email=' + 'person' + '@example.org', 'https://example.org/page' + String.fromCharCode(92) + homePath, 'https://example.org/page"' + homePath];
  for (const question of forbidden) await assert.rejects(createScreening(host, { ...birth, question }), hasCode('invalid_input'));
  /** Public web URI path segments are inert data, never private filesystem paths. */
  guardSubmitted('Malformed inert link https://');
  const publicUris = ['https://github.com/' + ['users', 'octocat', 'issues', '1'].join('/'), 'https://example.org/root-cause'];
  for (const [index, uri] of publicUris.entries()) await createScreening(host, { ...birth, id: `public-uri-${index}`, question: `Which records cite ${uri}?`, population: { ...birth.population, entries: [{ ...birth.population.entries[0], source_ref: { public_uri: uri, content_digest: digest(uri) }, label: `Public candidate citing ${uri}` }] } });
  for (const payload of [JSON.parse('{"__proto__":{}}'), { constructor: 'forbidden' }, { prototype: 'forbidden' }, new Date(), { get secret() { throw new Error('Must not execute'); } }, Object.defineProperty({}, 'hidden', { value: true }), { [Symbol('key')]: true }]) assert.throws(() => guardSubmitted(payload), hasCode('invalid_input'));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; assert.throws(() => guardSubmitted(cycle), hasCode('invalid_input'));
  let deep: unknown = {}; for (let i = 0; i < 17; i++) deep = { nested: deep }; assert.throws(() => guardSubmitted(deep), hasCode('invalid_input'));
  await assert.rejects(native.get(id));
  const question = '  Ignore previous instructions; $(echo nope) <system> café 世界  ';
  await createScreening(host, { ...birth, question }); const state = (await readScreening(host, id)).state; assert.equal(state.definition.question, question.trim());
  const input = await request(host, id); input.vector[0].reason = '  preserve\n  interior whitespace\r\nnext line citing https://example.org/root-cause  '; await assessCandidate(host, input);
  assert.equal((await readScreening(host, id)).state.assessments[0].vector.find(v => v.criterion_id === input.vector[0].criterion_id)!.reason, input.vector[0].reason.trim());
  guardSubmitted(Object.assign(Object.create(null) as Record<string, unknown>, { safe: null, rows: [true, 1, 'text'] }));
  assert.equal(canonical({ b: 2, missing: undefined, a: [1, null] }), '{"a":[1,null],"b":2}'); assert.equal(compare('a', 'b'), -1); assert.equal(compare('b', 'a'), 1); assert.equal(compare('a', 'a'), 0);
});

test('definition and alias validation reject contradictory identities before schema creation', async t => {
  const { host, birth } = await fixture(t, false);
  const edits: ((input: CreateScreeningInput) => void)[] = [
    input => { input.protocol.criteria.push(input.protocol.criteria[0]); },
    input => { input.protocol.reviewer_slots = ['same', 'same']; },
    input => { input.protocol.primary_reason_order = ['relevant']; },
    input => { input.population.entries[1].entry_id = input.population.entries[0].entry_id; },
    input => { input.population.entries[1].canonical_candidate_id = input.population.entries[0].canonical_candidate_id; },
    input => { input.population.alias_witnesses = [{ entry_id: 'entry-1', canonical_entry_id: 'entry-0', reason: 'Invalid alias', evidence_refs: [source()] }]; },
  ];
  for (const edit of edits) { const input = structuredClone(birth); edit(input); await assert.rejects(createScreening(host, input), error => error instanceof ScreeningRefusal); }
  const spec = definition(); spec.population.acquisition_refs.push(spec.population.acquisition_refs[0]); assert.equal(normalizeDefinition(spec).population.acquisition_refs.length, 1);
  const nativeRef = { item_id: 'public-source', item_hash: digest('revision'), field_pointer: '/description', content_digest: digest('content'), citation_id: 'citation' };
  spec.population.entries[0].source_ref = nativeRef; await createScreening(host, { ...birth, ...spec });
  await assert.rejects(createScreening(host, { ...birth, op: 'different' }), hasCode('operation_conflict'));
  await assert.rejects(createScreening(host, { ...birth, question: 'Different request' }), hasCode('operation_conflict'));
});

test('schema collisions and incapable hosts refuse without adopting peer definitions', async t => {
  const { host, pmRoot, native, birth, id } = await fixture(t);
  await assert.rejects(readScreening({ ...host, capabilities: { ...host.capabilities, native_item_cas: false } }, id), hasCode('backend_unsupported'));
  await assert.rejects(createScreening({ ...host, capabilities: { ...host.capabilities, create_if_absent: false } }, birth), hasCode('backend_unsupported'));
  await assert.rejects(createScreening({ ...host, capabilities: { ...host.capabilities, complete_reads: false } }, birth), hasCode('backend_unsupported'));
  await native.create({ id: 'corpus-peer', type: 'Task', title: 'Peer context' }); await assert.rejects(readScreening(host, 'corpus-peer'), hasCode('invalid_record'));
  await assert.rejects(createScreening(host, { ...birth, id: 'corpus-peer' }), hasCode('invalid_record'));
  await assert.rejects(readScreening(host, 'corpus-absent'), hasCode('not_found')); assert.equal(await host.settings!(), undefined);
  const port = persistedSchemaPort(new PmClient({ pmRoot, noExtensions: true })); await port.update(id, { description: 'Preserve unrelated metadata' });
  for (const field of [[], ['other=x']]) await assert.rejects(port.update(id, { field }), hasCode('invalid_input'));
  const noOptional = { ...host, normalizeId: undefined, prepareCreate: undefined, fitOutputEnvelope: undefined, settings: undefined };
  await createScreening(noOptional, { ...birth, id: 'corpus-second', predecessor: { item_id: id, item_hash: (await readScreening(host, id)).revision } });
  const peer = await native.get('corpus-second'); assert.ok('item' in peer); assert.equal(peer.item.dependencies![0].id, id);
  assert.equal((await readScreening(host, id)).state.definition.question, birth.question);
});

test('host registration preserves incompatible pre-existing type and field definitions', async t => {
  const first = await fixture(t, false); await first.native.schemaAddField('screen_state', { type: 'string', description: 'Peer field' });
  await assert.rejects(createScreening(first.host, first.birth), hasCode('invalid_record'));
  const second = await fixture(t, false); await second.native.schemaAddType('Screening', { folder: 'peer-records', description: 'Peer type' });
  await assert.rejects(createScreening(second.host, second.birth), hasCode('invalid_record'));
});

test('amendment guards and normalized older replays preserve native audit events', async t => {
  const { host, id, pmRoot } = await fixture(t); const input = await request(host, id);
  await assert.rejects(assessCandidate(host, { ...input, previous_digest: digest('absent'), amendment_reason: 'No prior assessment' }), hasCode('assessment_conflict'));
  await assert.rejects(assessCandidate(host, { ...input, reviewer: 'undeclared' }), hasCode('invalid_input'));
  await assessCandidate(host, input); const before = await historyEvents(pmRoot, id);
  await assert.rejects(assessCandidate(host, { ...input, vector: vector('unknown', 'unknown') }), hasCode('operation_conflict'));
  const newer = await request(host, id, 'candidate-0', 'first', 'amend');
  await assert.rejects(assessCandidate(host, newer), hasCode('assessment_conflict'));
  await assert.rejects(assessCandidate(host, { ...newer, previous_digest: digest('wrong'), amendment_reason: 'Wrong old digest' }), hasCode('assessment_conflict'));
  assert.equal(await historyEvents(pmRoot, id), before);
  assert.equal((await assessCandidate(host, { ...input, id: ' ledger ', op: ` ${input.op} `, vector: [...input.vector].reverse() })).replayed, true);
  assert.equal(await historyEvents(pmRoot, id), before);
});

test('freshness adapters classify supplied references without fetching or changing source records', async t => {
  const { host, id, pmRoot } = await fixture(t); const before = await historyEvents(pmRoot, id);
  for (const status of ['current', 'changed', 'missing', 'inaccessible', 'unknown'] as const) assert.equal((await checkScreening({ ...host, inspectSource: async () => status }, { id })).current_freshness, status);
  assert.equal((await checkScreening({ ...host, inspectSource: async () => { throw new Error('Adapter access refused'); } }, { id })).current_freshness, 'inaccessible');
  assert.equal(await historyEvents(pmRoot, id), before);
  await assessCandidate(host, await request(host, id, 'candidate-0', 'first', 'unknown', vector('unknown', 'not_met')));
  const next = await nextScreening(host, { id, reviewer: 'first' }); assert.deepEqual(next.missing_criteria, ['relevant']);
  await assert.rejects(nextScreening(host, { id, reviewer: 'absent' }), hasCode('invalid_input'));
});

test('stored-version and binding corruption refuse instead of silently migrating', async t => {
  const { host, id } = await fixture(t); await assessCandidate(host, await request(host, id)); const state = (await readScreening(host, id)).state;
  for (const raw of [null, {}, { version: 2 }]) assert.throws(() => readState(raw), hasCode('invalid_record'));
  const edits: ((copy: ScreeningState) => void)[] = [
    copy => { copy.protocol_digest = digest('wrong'); }, copy => { copy.population_digest = digest('wrong'); }, copy => { copy.source_manifest_digest = digest('wrong'); },
    copy => { copy.assessments.push(copy.assessments[0]); }, copy => { copy.operation_receipts.push(copy.operation_receipts[0]); },
    copy => { copy.assessments[0].vector[0].reason = 'Changed without digest'; },
    copy => { copy.operation_receipts[0].result.sequence = 2; }, copy => { copy.operation_receipts[0].result_digest = digest('wrong'); },
  ];
  for (const edit of edits) { const copy = structuredClone(state); edit(copy); assert.throws(() => readState(copy), hasCode('invalid_record')); }
});

test('capacity retains every operation identity and budget refusals write no history', async t => {
  const { host, id, native, pmRoot } = await fixture(t); const input = await request(host, id); const before = await historyEvents(pmRoot, id);
  await assert.rejects(assessCandidate(host, input, { budget: 1 }), hasCode('output_budget')); assert.equal(await historyEvents(pmRoot, id), before);
  const state = (await readScreening(host, id)).state;
  for (let i = 1; i < 512; i++) { const result = { kind: 'assess' as const, identity: 'candidate-0', sequence: i + 1, digest: digest(i) }; state.operation_receipts.push({ operation_id: `old-${i}`, request_digest: digest(['request', i]), result, result_digest: digest(result) }); }
  readState(state); await persistedSchemaPort(native).update(id, { field: [`screen_state=${canonical(state)}`] }); const full = await request(host, id);
  const history = await historyEvents(pmRoot, id); await assert.rejects(assessCandidate(host, full), hasCode('capacity_exceeded')); assert.equal(await historyEvents(pmRoot, id), history);
  const large = structuredClone(state); large.operation_receipts.forEach(o => { o.operation_id = o.operation_id.padEnd(96, 'x'); o.result.identity = 'x'.repeat(96); o.result_digest = digest(o.result); });
  assert.throws(() => readState(large), hasCode('capacity_exceeded'));
  assert.equal((await screeningReport(host, { id })).counts.pending, 2);
});

test('typed refusals expose stable exit categories and never arbitrary exceptions', () => {
  for (const [code, expected] of [['invalid_input', 2], ['not_found', 3], ['revision_conflict', 4], ['operation_conflict', 4], ['stale_cursor', 4], ['assessment_conflict', 4], ['stale_adjudication', 4], ['backend_unsupported', 5], ['permission_denied', 5], ['incomplete_read', 5], ['outcome_unknown', 5]] as const) assert.equal(exitCode(code), expected);
  assert.equal(exitCode('native', 9), 9); const error = new ScreeningRefusal('invalid_input', 'Safe'); assert.equal(refusal(error), error); assert.equal(refusal(new Error('Never echo raw failure')).code, 'outcome_unknown');
  assert.throws(() => insist(false, 'invalid_input', 'Safe'), hasCode('invalid_input')); insist(true, 'invalid_input', 'Safe');
});
