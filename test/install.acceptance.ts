import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { decode } from '@toon-format/toon';
import { locateTool, commandShell, commandPath } from '../scripts/consumer-tools.ts';
import { npmEnvironment } from '../scripts/environment.ts';
import { privateCases } from './path-cases.ts';
import { definition, vector } from './helpers.ts';
import { digest } from '../dist/index.js';
/** Execute a bounded, credential-free consumer process and assert its real exit code. */
function execute(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string, expected = 0): string {
  const command = isAbsolute(executable) ? executable : locateTool(executable, commandPath(env));
  const result = spawnSync(command, args, { cwd, env, input, shell: commandShell(command), encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, expected, `${executable} ${args.slice(0, 4).join(' ')}: ${result.stderr.slice(-1500)} ${result.stdout.slice(-1500)}`); return result.stdout || result.stderr;
}

test('one captured tarball works through npm bun npx bunx and both SDK runtimes with Git absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-packed-')); const env = npmEnvironment(process.env); const journeys: { manager: string; commands: number; runtime: string }[] = [];
  try {
    const packed = JSON.parse(execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd(), env)) as { filename: string; files: { path: string }[] }[];
    const archive = join(root, packed[0].filename); const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex'); const bin = join(root, 'bin'); mkdirSync(bin);
    const tools = new Map(['bun', 'npm', 'npx'].map(name => [name, locateTool(name, commandPath(env))]));
    for (const [name, target] of [...(process.platform === 'win32' ? [] : [['sh', '/bin/sh']]), ['node', process.execPath], ['bun', tools.get('bun')!], ['bunx', tools.get('bun')!], ['npm', tools.get('npm')!], ['npx', tools.get('npx')!]]) symlinkSync(target, join(bin, name + (process.platform === 'win32' ? extname(target) : '')));
    for (const manager of ['npm', 'bun']) {
      const cwd = join(root, manager); mkdirSync(cwd); writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'screen-consumer', version: '1.0.0', private: true, type: 'module' }));
      execute(manager, manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive, '@unbrained/pm-cli@2026.11.5'] : ['add', '--ignore-scripts', archive, '@unbrained/pm-cli@2026.11.5'], cwd, env);
      const safe = { ...env, PM_PATH: join(cwd, '.agents/pm'), PM_AUTHOR: 'consumer', PATH: bin, GIT_CEILING_DIRECTORIES: root, HOME: join(root, 'isolated-home') }; mkdirSync(safe.HOME, { recursive: true });
      const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm']; let commands = 0;
      /** Exercise the installed extension with no Git executable available. */
      const run = (args: string[], input?: string, expected = 0) => { commands++; return execute(runner, [...prefix, ...args], cwd, safe, input, expected); };
      run(['init', 'packed', '--defaults', '--agent-guidance', 'skip', '--no-merge-fence']); run(['package', 'install', './node_modules/pm-screen']); assert.match(run(['screen', '--help']), /screen/);
      const contracts = run(['contracts', '--json', '--output-budget', 'unbounded']); for (const command of ['create', 'next', 'assess', 'resolve', 'report', 'check', 'packet']) assert.ok(contracts.includes(`screen ${command}`));
      const queueSpec = definition();
      const queueBirth = JSON.parse(run(['screen', 'create', '--id', 'packed-queue', '--op', 'birth', '--input', '-', '--json'], JSON.stringify(queueSpec)));
      const queueNext = JSON.parse(run(['screen', 'next', 'packed-queue', '--reviewer', 'first', '--json'])).data;
      const queueInput = { candidate: 'candidate-0', reviewer: 'first', protocol_digest: queueNext.protocol_digest, source_digest: queueNext.source_digest, vector: vector('unknown', 'not_met') };
      run(['screen', 'assess', 'packed-queue', '--op', 'unknown', '--revision', queueBirth.revision, '--input', '-', '--json'], JSON.stringify(queueInput));
      const queueArgs = ['screen', 'next', 'packed-queue', '--reviewer', 'first']; const queueJson = JSON.parse(run([...queueArgs, '--json']));
      assert.equal(queueJson.data.candidate.canonical_candidate_id, 'candidate-1', 'Packed CLI must advance beyond uncertain work'); assert.deepEqual(decode(run(queueArgs)), queueJson);
      writeFileSync(join(cwd, 'queue-sdk.ts'), `
import assert from 'node:assert/strict';
import {createDirectoryHost,readScreening,createScreening,assessCandidate,resolveScreening,nextScreening,digest} from 'pm-screen';
const host=createDirectoryHost(process.cwd()+'/.agents/pm','consumer'); const id='packed-queue';
const owner=await readScreening(host,id); const next=await nextScreening(host,{id,reviewer:'first'});
assert.equal(next.candidate.canonical_candidate_id,'candidate-1','Packed SDK must advance beyond uncertain work');
const input={id,op:'complete-second',revision:owner.revision,candidate:'candidate-1',reviewer:'first',protocol_digest:owner.state.protocol_digest,source_digest:digest(next.candidate.source_ref),vector:${JSON.stringify(vector())}};
const extra=Array.from({length:262144},()=>null);
await assert.rejects(createScreening(host,{id:'packed-rejected',op:'birth',...${JSON.stringify(queueSpec)},extra}),/Aggregate node scanning budget exceeded/);
await assert.rejects(assessCandidate(host,{...input,extra}),/Aggregate node scanning budget exceeded/);
await assert.rejects(resolveScreening(host,{id,op:'resolve',revision:owner.revision,candidate:'candidate-0',assessment_digests:[],vector:input.vector,rationale:'Reviewed',extra}),/Aggregate node scanning budget exceeded/);
assert.deepEqual(await readScreening(host,id),owner);
await assessCandidate(host,input); assert.equal((await nextScreening(host,{id,reviewer:'first'})).candidate.canonical_candidate_id,'candidate-0');
const current=await readScreening(host,id); const previous=current.state.assessments.find(a=>a.candidate==='candidate-0');
await assessCandidate(host,{...input,op:'complete-first',revision:current.revision,candidate:'candidate-0',source_digest:previous.source_digest,previous_digest:previous.assessment_digest,amendment_reason:'Evidence available'});
assert.equal((await nextScreening(host,{id,reviewer:'first'})).candidate,null); console.log('QUEUE SDK OK');
`);
      assert.match(execute(manager === 'npm' ? 'node' : 'bun', ['queue-sdk.ts'], cwd, safe), /QUEUE SDK OK/);
      const spec = definition(2, ['first', 'second']); const birthInput = JSON.stringify(spec);
      const birth = JSON.parse(run(['screen', 'create', '--id', 'packed-ledger', '--op', 'birth', '--input', '-', '--json'], birthInput)); assert.equal(birth.ok, true);
      const firstNext = JSON.parse(run(['screen', 'next', 'packed-ledger', '--reviewer', 'first', '--json'])); assert.equal(firstNext.ok, true);
      const assessment = { candidate: 'candidate-0', reviewer: 'first', protocol_digest: firstNext.data.protocol_digest, source_digest: firstNext.data.source_digest, vector: vector() };
      const first = JSON.parse(run(['screen', 'assess', 'packed-ledger', '--op', 'first', '--revision', birth.revision, '--input', '-', '--json'], JSON.stringify(assessment))); assert.equal(first.ok, true);
      const second = JSON.parse(run(['screen', 'assess', 'packed-ledger', '--op', 'second', '--revision', first.revision, '--input', '-', '--json'], JSON.stringify({ ...assessment, reviewer: 'second', vector: vector('not_met', 'not_met') }))); assert.equal(second.ok, true);
      const reportJson = run(['screen', 'report', 'packed-ledger', '--json']); const reportToon = run(['screen', 'report', 'packed-ledger']);
      assert.deepEqual(JSON.parse(reportJson), decode(reportToon)); assert.equal(JSON.parse(reportJson).data.counts.conflict, 1);
      for (const text of [reportJson, reportToon]) assert.ok(Math.ceil(Buffer.byteLength(text) / 4) <= 1600);
      const packet = JSON.parse(run(['screen', 'packet', 'packed-ledger', '--limit', '1', '--budget', '8192', '--json'])); assert.equal(packet.data.rows[0].decision.assessments.length, 2);
      const resolution = { assessment_digests: packet.data.rows[0].decision.assessments.map((row: { assessment_digest: string }) => row.assessment_digest), vector: vector(), rationale: 'Explicit consumer adjudication' };
      const resolved = JSON.parse(run(['screen', 'resolve', 'packed-ledger', '--candidate', 'candidate-0', '--op', 'resolve', '--revision', second.revision, '--input', '-', '--json'], JSON.stringify(resolution))); assert.equal(resolved.ok, true);
      assert.equal(JSON.parse(run(['screen', 'check', 'packed-ledger', '--json'])).data.current_freshness, 'unknown');
      const page = JSON.parse(run(['screen', 'packet', 'packed-ledger', '--limit', '1', '--budget', '8192', '--json'])); assert.ok(page.next_cursor);
      assert.equal(JSON.parse(run(['screen', 'packet', 'packed-ledger', '--limit', '1', '--cursor', page.next_cursor, '--budget', '8192', '--json'])).data.rows[0].entry.canonical_candidate_id, 'candidate-1');
      assert.equal(JSON.parse(run(['screen', 'packet', 'packed-ledger', '--limit', '1', '--output-cursor', page.next_cursor, '--json'], undefined, 2)).code, 'read_output_cursor_invalid');
      assert.equal(JSON.parse(run(['screen', 'assess', 'packed-ledger', '--op', 'stale', '--revision', birth.revision, '--input', '-', '--json'], JSON.stringify(assessment), 4)).refusal.code, 'revision_conflict');
      assert.equal(JSON.parse(run(['screen', 'assess', 'packed-ledger', '--op', 'first', '--revision', birth.revision, '--input', '-', '--json'], JSON.stringify(assessment))).data.replayed, true);
      assert.equal(JSON.parse(run(['screen', 'assess', 'packed-ledger', '--op', 'first', '--revision', birth.revision, '--input', '-', '--json'], JSON.stringify({ ...assessment, vector: vector('unknown', 'unknown') }), 4)).refusal.code, 'operation_conflict');
      for (const reason of [...privateCases().flatMap(path => [path, path + '...']), '\u001b[31m', '/' + ['home', 'example', 'secret'].join('/'), 'ghp_' + 'A'.repeat(36)]) {
        const invalid = { ...assessment, vector: [{ ...assessment.vector[0], reason }, assessment.vector[1]] };
        const args = ['screen', 'assess', 'packed-ledger', '--op', 'unsafe', '--revision', resolved.revision, '--input', '-'];
        const json = JSON.parse(run([...args, '--json'], JSON.stringify(invalid), 2));
        assert.equal(json.refusal.code, 'invalid_input'); assert.deepEqual(decode(run(args, JSON.stringify(invalid), 2)), json);

      }
      assert.equal(JSON.parse(run(['screen', 'report', 'packed-ledger', '--json'])).revision, resolved.revision);
      assert.equal(JSON.parse(run(['screen', 'report', 'packed-absent', '--json'], undefined, 3)).refusal.code, 'not_found');
      const minimum = JSON.parse(run(['screen', 'report', 'packed-ledger', '--budget', '1', '--json'], undefined, 2)).refusal.details.minimum_usable_budget;
      assert.ok(minimum > 1); assert.equal(JSON.parse(run(['screen', 'report', 'packed-ledger', '--budget', String(minimum), '--json'])).ok, true);
      assert.equal(JSON.parse(run(['screen', 'create', '--id', 'packed-refused', '--op', 'tiny', '--input', '-', '--budget', '1', '--json'], birthInput, 2)).refusal.code, 'output_budget');
      assert.equal(JSON.parse(run(['screen', 'report', 'packed-refused', '--json'], undefined, 3)).refusal.code, 'not_found');
      writeFileSync(join(cwd, 'sdk.ts'), `import assert from 'node:assert/strict';import {createDirectoryHost,readScreening,assessCandidate,screeningReport,screeningPacket,nextScreening,digest,canonical} from 'pm-screen';const host=createDirectoryHost(process.cwd()+'/.agents/pm','consumer');const owner=await readScreening(host,'packed-ledger');const entry=owner.state.definition.population.entries[1];await assessCandidate(host,{id:owner.id,op:'sdk',revision:owner.revision,candidate:entry.canonical_candidate_id,reviewer:'first',protocol_digest:owner.state.protocol_digest,source_digest:digest(entry.source_ref),vector:${JSON.stringify(vector('unknown', 'not_met'))}});assert.equal((await screeningReport(host,{id:owner.id})).counts.included,1);const legacy=await readScreening(host,owner.id);const row=legacy.state.assessments.find(a=>a.candidate===entry.canonical_candidate_id);row.vector[0].reason='Legacy ~...';const {assessment_digest:old,...content}=row;row.assessment_digest=digest(content);await host.client.update(owner.id,{field:['screen_state='+canonical(legacy.state)]});assert.equal((await screeningReport(host,{id:owner.id})).counts.included,1);await nextScreening(host,{id:owner.id,reviewer:'first'});await screeningPacket(host,{id:owner.id},{budget:8192});console.log('SDK OK '+(globalThis.Bun?'bun':'node'));`);
      const runtime = manager === 'npm' ? 'node' : 'bun'; assert.match(execute(runtime, ['sdk.ts'], cwd, safe), new RegExp(`SDK OK ${runtime}`));
      const legacyArgs = ['screen', 'packet', 'packed-ledger', '--candidate', 'candidate-1', '--budget', '8192'];
      const legacyJson = JSON.parse(run([...legacyArgs, '--json'])); assert.equal(legacyJson.ok, true); assert.deepEqual(decode(run(legacyArgs)), legacyJson);
      const revision = JSON.parse(run(['screen', 'report', 'packed-ledger', '--json'])).revision; assert.notEqual(revision, resolved.revision);
      assert.equal(JSON.parse(run(['screen', 'packet', 'packed-ledger', '--limit', '1', '--cursor', page.next_cursor, '--budget', '8192', '--json'], undefined, 4)).refusal.code, 'stale_cursor');
      assert.equal(digest(spec.protocol).length, 64); journeys.push({ manager, commands, runtime });
    }
    const handoff = join(root, 'handoff'); mkdirSync(join(handoff, 'release-artifact'), { recursive: true }); mkdirSync(join(handoff, 'dist')); copyFileSync(archive, join(handoff, 'release-artifact/package.tgz')); writeFileSync(join(handoff, 'dist/index.js'), 'throw new Error("Changed ignored distribution");\n');
    const publisherBin = join(root, 'publisher-bin'); mkdirSync(publisherBin); symlinkSync(process.execPath, join(publisherBin, 'node'));
    writeFileSync(join(publisherBin, 'npm'), '#!/usr/bin/env node\nconst fs=require("node:fs"),crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[3])).digest("hex"));\n'); chmodSync(join(publisherBin, 'npm'), 0o755);
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8'); const publish = workflow.split('\n').find(line => /^\s*npm publish /.test(line))!.trim();
    assert.equal(execute('/bin/bash', ['-c', publish], handoff, { ...env, PATH: publisherBin }), sha256);
    const verify = workflow.split('\n').find(line => line.includes('sha256sum --check --strict'))!.trim(); assert.match(execute('/bin/bash', ['-c', verify], handoff, { ...env, ARTIFACT_SHA256: sha256 }), /OK/);
    writeFileSync(join(handoff, 'release-artifact/package.tgz'), 'Changed archive'); execute('/bin/bash', ['-c', verify], handoff, { ...env, ARTIFACT_SHA256: sha256 }, undefined, 1);
    writeFileSync('packed-receipt.local.json', JSON.stringify({ sha256, files: packed[0].files.map(f => f.path), journeys, git_in_path: false, archive_handoff_verified: true }, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
