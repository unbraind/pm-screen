import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDirectoryHost, assessCandidate, createScreening, readScreening, screeningReport } from '../dist/index.js';
import { fixture, request, hasCode, historyEvents, definition } from './helpers.ts';
import type { TestContext } from 'node:test';
import { npmEnvironment } from '../scripts/environment.ts';

/** Prepare two authorized peers sharing one native owner. */
async function writers(t: TestContext) { const context = await fixture(t); return { ...context, peer: createDirectoryHost(context.pmRoot, 'peer'), input: await request(context.host, context.id) }; }

const steps = ['after_read', 'after_plan', 'before_guard', 'before_update', 'after_update', 'after_guard', 'before_receipt'];
for (const step of steps) test(`competing write at ${step} either refuses stale owner or preserves both acknowledged judgments`, async t => {
  const { host, id, pmRoot, peer, input } = await writers(t); let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await assessCandidate(peer, await request(peer, id, 'candidate-1')); } };
  const beforeCommit = ['after_read', 'after_plan', 'before_guard', 'before_update'].includes(step);
  if (beforeCommit) await assert.rejects(assessCandidate(host, input), hasCode('revision_conflict')); else await assessCandidate(host, input);
  assert.equal(injected, true); delete host.boundary;
  if (beforeCommit) await assessCandidate(host, { ...input, revision: (await readScreening(host, id)).revision });
  assert.equal((await screeningReport(host, { id })).counts.included, 2); assert.equal(await historyEvents(pmRoot, id), 3);
});
for (const step of steps) test(`identical request at ${step} commits once and reruns converge`, async t => {
  const context = await writers(t); const { host, input, pmRoot, id } = context; let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await assessCandidate(context.peer, input); } };
  if (['after_read', 'after_plan', 'before_guard', 'before_update'].includes(step)) await assert.rejects(assessCandidate(host, input), hasCode('revision_conflict')); else await assessCandidate(host, input);
  delete host.boundary; assert.equal((await assessCandidate(host, input)).replayed, true); assert.equal(await historyEvents(pmRoot, id), 2);
});
for (const step of steps) test(`interruption at ${step} converges using the original operation key`, async t => {
  const { host, id, pmRoot } = await fixture(t); const input = await request(host, id);
  host.boundary = async point => { if (point === step) throw new Error('Synthetic process interruption'); };
  await assert.rejects(assessCandidate(host, input), hasCode('outcome_unknown')); delete host.boundary;
  assert.equal((await assessCandidate(host, input)).replayed, ['after_update', 'after_guard', 'before_receipt'].includes(step)); assert.equal(await historyEvents(pmRoot, id), 2);
});
for (const step of ['before_create', 'after_create', 'before_receipt']) test(`create collision and lost receipt at ${step} converge by explicit identity`, async t => {
  const { host, birth, pmRoot } = await fixture(t, false); const peer = createDirectoryHost(pmRoot, 'peer'); let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await createScreening(peer, birth); throw new Error('Synthetic lost creation receipt'); } };
  await assert.rejects(createScreening(host, birth), hasCode('outcome_unknown')); delete host.boundary;
  assert.equal((await createScreening(host, birth)).replayed, true); assert.equal(await historyEvents(pmRoot, birth.id), 1);
});
for (const step of ['before_create', 'after_create']) test(`creation interruption at ${step} converges without a peer`, async t => {
  const { host, birth, pmRoot } = await fixture(t, false); host.boundary = async point => { if (point === step) throw new Error('Synthetic crash'); };
  await assert.rejects(createScreening(host, birth), hasCode('outcome_unknown')); delete host.boundary;
  assert.equal((await createScreening(host, birth)).replayed, step === 'after_create'); assert.equal(await historyEvents(pmRoot, birth.id), 1);
});
/** Collect subprocess output and reject unexpected exits without logging environment values. */
async function childResult(path: string, args: string[], expected = 0): Promise<string> {
  return new Promise((resolve, reject) => { const child = spawn(process.execPath, [path, ...args], { env: npmEnvironment(process.env) }); let out = '', err = '';
    child.stdout.on('data', chunk => { out += String(chunk); }); child.stderr.on('data', chunk => { err += String(chunk); }); child.on('error', reject); child.on('close', code => code === expected ? resolve(out) : reject(new Error(`Unexpected worker exit ${code}: ${err}`)));
  });
}
test('two OS writers retain every acknowledgment exactly once, with explicit stale-write refusals', async t => {
  const { host, id, root, pmRoot } = await fixture(t, true, definition(20)); const worker = join(root, 'writer.ts');
  await writeFile(worker, `import {createDirectoryHost,assessCandidate,readScreening,digest} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],process.argv[3]);const id=process.argv[4];const start=Number(process.argv[5]);const accepted=[],refused=[];for(let i=start;i<start+10;i++){const owner=await readScreening(host,id);const entry=owner.state.definition.population.entries.find(e=>e.canonical_candidate_id==='candidate-'+i);const input={id,op:'op-'+i,revision:owner.revision,candidate:entry.canonical_candidate_id,reviewer:'first',protocol_digest:owner.state.protocol_digest,source_digest:digest(entry.source_ref),vector:owner.state.definition.protocol.criteria.map(c=>({criterion_id:c.criterion_id,value:c.kind==='inclusion'?'met':'not_met',evidence_refs:[entry.source_ref],reason:'Reviewed public source'}))};try{await assessCandidate(host,input);accepted.push(input.op);}catch(error){if(error.code!=='revision_conflict')throw error;refused.push(input.op);}}console.log(JSON.stringify({accepted,refused}));`);
  const results = await Promise.all([childResult(worker, [pmRoot, 'writer-a', id, '0']), childResult(worker, [pmRoot, 'writer-b', id, '10'])]);
  const parsed = results.map(text => JSON.parse(text) as { accepted: string[]; refused: string[] }); const accepted = parsed.flatMap(r => r.accepted).sort(); const refused = parsed.flatMap(r => r.refused);
  const state = (await readScreening(host, id)).state; assert.equal(accepted.length + refused.length, 20); assert.ok(accepted.length > 0); assert.deepEqual(state.operation_receipts.slice(1).map(o => o.operation_id).sort(), accepted); assert.equal(state.assessments.length, accepted.length); assert.equal(await historyEvents(pmRoot, id), accepted.length + 1);
  t.diagnostic(JSON.stringify({ requests: 20, acknowledged: accepted.length, explicit_conflicts: refused.length, preserved: state.assessments.length }));
});
for (const step of ['before_update', 'after_update', 'before_receipt']) test(`hard OS exit at ${step} retains durable replay convergence`, async t => {
  const { host, id, root, pmRoot } = await fixture(t); const input = await request(host, id); const worker = join(root, 'crash.ts');
  await writeFile(worker, `import {createDirectoryHost,assessCandidate} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],'crash-writer');host.boundary=async step=>{if(step===process.argv[3])process.exit(73);};await assessCandidate(host,JSON.parse(process.argv[4]));`);
  await childResult(worker, [pmRoot, step, JSON.stringify(input)], 73); const replay = await assessCandidate(host, input); assert.equal(replay.replayed, step !== 'before_update'); assert.equal(await historyEvents(pmRoot, id), 2);
  const history = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'); assert.match(history, /screen:assess/);
});
