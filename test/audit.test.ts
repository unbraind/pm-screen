import { testTime } from './support/depth.ts';
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
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: testTime(180000) });
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
      // CI must take the matrix version, so the 26 job really runs Node 26; release jobs may pin the floor directly.
      if (/uses: actions\/setup-node@/.test(step)) assert.match(step, path.endsWith('ci.yml') ? /node-version: \$\{\{ matrix\.node-version \}\}/ : /node-version: (?:'22\.19\.0'|\$\{\{ matrix.node-version \}\})/, 'Node provisioning must pin the claimed version');
    }
    if (path.endsWith('ci.yml')) {
      // Every assertion reads the test job's own block, so comments or other jobs cannot satisfy them.
      const testJob = workflow.split(/(?=^  [A-Za-z0-9_-]+:\s*$)/m).find(job => /^  test:\s*$/m.test(job.split('\n')[0])) ?? '';
      assert.equal(testJob.match(/^    name: (.+)$/m)?.[1]?.trim(), 'test (${{ matrix.major }})', 'Required check names must not carry the patch version');
      // Versions are listed in an include with a major key so the required check names stay test (22) and test (26).
      const included = [...testJob.matchAll(/^[ \t]+- node-version: '([^']+)'\s*\n[ \t]+major: (\d+)[ \t]*$/gm)].map(entry => `${entry[2]}=${entry[1]}`).join(',');
      assert.equal(included, '22=22.19.0,26=26.0.0', 'The CI matrix must provision exactly the claimed runtimes');
      const setups = testJob.split(/(?=^      - name:)/m).filter(step => /uses: actions\/setup-node@/.test(step));
      assert.ok(setups.length > 0 && setups.every(step => /node-version: \$\{\{ matrix\.node-version \}\}/.test(step)), 'The test job must provision Node from the matrix');
    }
    else {
      assert.doesNotMatch(workflow, /uses: oven-sh\/setup-bun@|\brun:.*\bbun\b/, 'Privileged jobs must exclude unused Bun execution');
      assert.match(workflow, /uses: unbraind\/pm-ops\/\.github\/workflows\/daily-release\.yml@[a-f0-9]{40}/u);
      const jobs = workflow.split(/(?=^  [a-z_]+:\s*$)/m).slice(1);
      for (const job of jobs) {
        if (/^  (?:prepare|verify_bun):/.test(job)) assert.match(job, /uses: oven-sh\/setup-bun@/, 'Build and Bun acceptance jobs require Bun');
        if (/^      (?:[\w-]+): write$/m.test(job)) assert.doesNotMatch(job, /uses: oven-sh\/setup-bun@|\brun:.*\bbun\b/, 'Privileged jobs must exclude unused Bun execution');
      }
    }
  }
  const source = readFileSync('README.md', 'utf8').replaceAll('\r\n', '\n');
  for (const fixture of [source, source.replaceAll('\n', '\r\n')]) {
    const readme = fixture.replaceAll('\r\n', '\n');
    const blocks = [...readme.matchAll(/```sh\n([\s\S]*?)```/g)].map(match => match[1].trim().split('\n').map(line => line.trimStart()));
    for (const command of ['npm install', 'bun add']) {
      const install = `${command} "$archive" @unbrained/pm-cli || exit 1`;
      const block = blocks.find(lines => lines.includes(install));
      assert.ok(block, `The README must document the ${command} archive path`);
      assert.deepEqual(block.slice(0, block.indexOf(install)), [
        '(',
        'npm ci || exit 1',
        'tarball=$(npm pack --silent) && test -n "$tarball" && test -f "$tarball" || exit 1',
        'packed_version=$(node -p \'require("./package.json").version\') || exit 1',
        'archive="$(pwd)/$tarball"',
        'consumer=$(mktemp -d -t pm-screen.XXXXXX) && test -n "$consumer" && cd "$consumer" || exit 1',
      ]);
    }
    assert.match(readme, /await native.init\('screening'/, 'SDK example must initialize a new tracker');
  }
});

test('trusted publishing requires the direct-publish allowed action', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /select `npm publish` under \*\*Allowed actions\*\*/);
  assert.match(readme, /created after September 3, 2026 default to\s+`npm stage publish` only/);
  assert.match(readme, /https:\/\/docs\.npmjs\.com\/trusted-publishers\//);
});

test('documented archive installs guard setup and verify the installed version', t => {
  const readme = readFileSync('README.md', 'utf8').replaceAll('\r\n', '\n');
  const blocks = [...readme.matchAll(/^```sh\n([\s\S]*?)^```$/gm)]
    .map(match => match[1])
    .filter(block => /^[ \t]*(?:tarball=|(?:npm install|bun add) "\$archive")/m.test(block));
  assert.ok(blocks.length > 0, 'The README must document an archive installation');
  const source = mkdtempSync(join(tmpdir(), 'readme-pack-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  writeFileSync(join(source, 'package.tgz'), 'synthetic archive');
  writeFileSync(join(source, 'package.json'), '{"version":"1.2.3"}');
  const installed = join(source, 'consumer', 'node_modules', 'pm-screen');
  mkdirSync(installed, { recursive: true });

  const stubs = String.raw`
scenario=$1
source=$PWD
npm() {
  case "$1" in
    ci) return 0 ;;
    pack)
      printf 'pack\n' >&2
      case "$scenario" in
        pack_failed) printf '%s\n' package.tgz; return 33 ;;
        pack_empty) return 0 ;;
        pack_missing) printf '%s\n' missing.tgz; return 0 ;;
        *) printf '%s\n' package.tgz ;;
      esac
      ;;
    install) install_archive ;;
    *) return 90 ;;
  esac
}
bun() { [ "$1" = add ] && install_archive; }
install_archive() {
  printf 'install\n' >&2
  [ "$PWD" = "$source/consumer" ] && [ "$scenario" != install_failed ]
}
mktemp() {
  printf 'mktemp\n' >&2
  printf '%s\n' "$source/consumer"
  [ "$scenario" != mktemp_failed ]
}
cd() {
  printf 'cd\n' >&2
  [ "$scenario" != cd_failed ] && command cd "$@"
}
npx() { printf 'cli\n' >&2; }
bunx() { printf 'cli\n' >&2; }
`;
  const cases = [
    ['pack_failed', 'pack\n', 1],
    ['pack_empty', 'pack\n', 1],
    ['pack_missing', 'pack\n', 1],
    ['mktemp_failed', 'pack\nmktemp\n', 1],
    ['cd_failed', 'pack\nmktemp\ncd\n', 1],
    ['install_failed', 'pack\nmktemp\ncd\ninstall\n', 1],
    ['version_match', 'pack\nmktemp\ncd\ninstall\n', 0],
    ['version_mismatch', 'pack\nmktemp\ncd\ninstall\n', 1],
  ] as const;
  for (const block of blocks) {
    assert.match(block.trim(), /^\(\n[\s\S]*\n\)$/, 'The archive install must run in a subshell');
    const cliTrace = 'cli\n'.repeat([...block.matchAll(/^\s*(?:npx|bunx) /gm)].length);
    for (const [scenario, trace, status] of cases) {
      const version = scenario === 'version_mismatch' ? '9.9.9' : '1.2.3';
      writeFileSync(join(installed, 'package.json'), JSON.stringify({ version }));
      const result = spawnSync('sh', ['-c', `${stubs}\n${block}\nprintf 'shell continued: %s\\n' "$?"`, 'readme-pack', scenario], {
        cwd: source,
        encoding: 'utf8',
      });
      assert.ifError(result.error);
      const versionCheck = scenario.startsWith('version_');
      const mismatch = scenario === 'version_mismatch' ? 'Expected version 1.2.3, installed 9.9.9.\n' : '';
      assert.equal(result.stderr, trace + (versionCheck ? cliTrace : '') + mismatch, scenario);
      assert.equal(result.status, 0, `${scenario}: the calling shell must continue`);
      assert.equal(result.stdout, `shell continued: ${status}\n`, scenario);
    }
  }
});
