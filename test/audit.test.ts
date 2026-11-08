import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { locateTool, commandShell, commandPath } from '../scripts/consumer-tools.ts';

for (const rows of [10, 11]) test(`corpus measurement derives ${rows} agreements and evaluation never writes a partial receipt`, () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-corpus-oracle-'));
  try {
    for (const path of ['test/fixtures', 'docs']) cpSync(path, join(root, path), { recursive: true });
    const fixture = JSON.parse(readFileSync('test/fixtures/public-corpus.json', 'utf8'));
    fixture.sets = [fixture.sets.find((set: { key: string }) => set.key === 'tracker-items')]; fixture.sets[0].rows = fixture.sets[0].rows.slice(0, rows);
    writeFileSync(join(root, 'test/fixtures/public-corpus.json'), JSON.stringify(fixture));
    const gold = JSON.parse(readFileSync('test/fixtures/expected-decisions.json', 'utf8')); const ids = new Set(fixture.sets[0].rows.map((row: { id: string }) => row.id));
    gold.sets = gold.sets.filter((set: { key: string }) => set.key === 'tracker-items');
    for (const disposition of ['included', 'excluded', 'uncertain', 'pending', 'conflict']) gold.sets[0][disposition] = gold.sets[0][disposition].filter((id: string) => ids.has(id));
    writeFileSync(join(root, 'test/fixtures/expected-decisions.json'), JSON.stringify(gold));
    const receipt = join(root, 'docs/real-data-receipt.json'); const before = readFileSync(receipt, 'utf8');
    const code = `import {evaluateCorpus} from ${JSON.stringify(new URL('./corpus.ts', import.meta.url).href)}; console.log(JSON.stringify(await Reflect.apply(evaluateCorpus, undefined, [true])));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 180000 });
    assert.equal(run.status, 0, run.stdout + run.stderr); const measured = JSON.parse(run.stdout);
    assert.equal(measured.mechanical_agreement, `${rows}/${rows} explicit submitted vectors and independent ID decisions`, 'Agreement must count the evaluated corpus');
    assert.equal(measured.corpus[0].candidates, rows); assert.equal(readFileSync(receipt, 'utf8'), before, 'Evaluation must never overwrite the complete receipt');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('linked consumer commands resolve POSIX and Windows PATH entries and command shims', () => {
  assert.equal(commandPath({ Path: 'windows-path' }), 'windows-path'); assert.equal(commandPath({ PATH: 'posix-path' }), 'posix-path'); assert.equal(commandPath({}), '');
  const root = mkdtempSync(join(tmpdir(), 'screen-tools-'));
  try {
    const first = join(root, 'first'); const last = join(root, 'last'); mkdirSync(first); mkdirSync(last);
    const tool = join(last, 'consumer'); writeFileSync(tool, 'fixture'); chmodSync(tool, 0o755); const linked = join(first, 'linked'); symlinkSync(tool, linked);
    assert.equal(locateTool('linked', [first, last].join(delimiter), 'linux'), linked);
    assert.equal(locateTool('consumer', [first, last].join(delimiter), 'linux'), tool);
    for (const extension of ['.exe', '.cmd', '.bat']) {
      const path = join(last, 'consumer' + extension); writeFileSync(path, 'fixture'); assert.equal(locateTool('consumer', [first, last].join(';'), 'win32'), path); rmSync(path);
    }
    assert.throws(() => locateTool('absent', root), /Required consumer tool unavailable/);
    assert.equal(commandShell('npm.cmd', 'win32'), true); assert.equal(commandShell('node.exe', 'win32'), false); assert.equal(commandShell('npm', 'linux'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every CI and release runtime setup pins exact versions and release gates provision Bun', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const workflow = readFileSync(path, 'utf8');
    for (const step of workflow.split(/(?=^      - name:)/m)) {
      if (/uses: oven-sh\/setup-bun@/.test(step)) assert.match(step, /bun-version: '1\.3\.5'/, 'Bun provisioning must pin the claimed version');
      if (/uses: actions\/setup-node@/.test(step)) assert.match(step, /node-version: (?:'22\.19\.0'|\$\{\{ matrix.node-version \}\})/, 'Node provisioning must pin the claimed version');
    }
    if (path.endsWith('ci.yml')) assert.match(workflow, /node-version: \['22\.19\.0', '26\.0\.0'\]/);
    else {
      const jobs = workflow.split(/(?=^  [a-z_]+:\s*$)/m).slice(1);
      for (const job of jobs) {
        if (/^  (?:prepare|verify_bun):/.test(job)) assert.match(job, /uses: oven-sh\/setup-bun@/, 'Build and Bun acceptance jobs require Bun');
        if (/^      (?:[\w-]+): write$/m.test(job)) assert.doesNotMatch(job, /uses: oven-sh\/setup-bun@|\brun:.*\bbun\b/, 'Privileged jobs must exclude unused Bun execution');
      }
    }
  }
  const readme = readFileSync('README.md', 'utf8'); assert.ok(readme.indexOf('npm pack') < readme.indexOf('npm install ./pm-screen-'));
  assert.match(readme, /await native.init\('screening'/, 'SDK example must initialize a new tracker');
});
