import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment } from '../scripts/environment.ts';
const root = mkdtempSync(join(tmpdir(), 'screen-revert-')); const env = npmEnvironment(process.env); const receipts = [];
/** Run only in the disposable copy; all mutations are restored in finally. */
function execute(args: string[]) { return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
const mutations = [
  { file: 'kernel.ts', from: 'assessments[0].vector.some(value => value.value !== assessments[1].vector.find(other => other.criterion_id === value.criterion_id)!.value)', to: 'assessments[0].vector.some((value, i) => value.value !== assessments[1].vector[i].value)', name: 'criterion-identity', test: 'revert criterion identity' },
  { file: 'kernel.ts', from: 'failed && value.evidence_refs.length > 0', to: 'failed', name: 'witnessed-exclusion', test: 'revert eligibility' },
  { file: 'kernel.ts', from: "value.value === 'unknown' ||", to: 'false ||', name: 'unknown-retention', test: 'revert eligibility' },
  { file: 'api.ts', from: 'itemHash: input.revision', to: 'itemHash: (await host.client.readItemRevision(snapshot.id)).item_hash', name: 'native-cas', test: 'revert native CAS' },
  { file: 'api.ts', from: 'const previous = replay(snapshot.state, input.op, normalized); if (previous)', to: 'const previous = replay(snapshot.state, input.op, normalized); if (previous && Boolean(0))', name: 'older-replay', test: 'revert original request replay' },
  { file: 'kernel.ts', from: 'const opposed = assessments.length === 2', to: 'const opposed = Boolean(0) && assessments.length === 2', name: 'criterion-disagreement', test: 'revert criterion conflicts' },
  { file: 'kernel.ts', from: 'const stale = adjudication !== null', to: 'const stale = Boolean(0) && adjudication !== null', name: 'stale-adjudication', test: 'revert criterion conflicts' },
  { file: 'api.ts', from: 'preflight(host, snapshot.id, operation, options);', to: 'void options;', name: 'write-budget-preflight', test: 'revert write budget' },
  { file: 'kernel.ts', from: ' && entry.source_ref.content_digest === first.source_ref.content_digest', to: '', name: 'exact-alias', test: 'revert alias witness' },
  { file: 'output.ts', from: "if ('output_budget_exceeded' in object || receipt?.strings_compacted", to: "if ('output_budget_exceeded' in object || false", name: 'native-compaction', test: 'revert host compaction' },
];
try {
  for (const path of ['src', 'index.ts', 'package.json', 'tsconfig.json']) cpSync(path, join(root, path), { recursive: true }); mkdirSync(join(root, 'test'));
  for (const file of ['helpers.ts', 'revert-regression.ts']) cpSync(join('test', file), join(root, 'test', file)); symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  assert.equal(execute(['node_modules/typescript/bin/tsc']).status, 0); const baseline = execute(['--test', '--test-concurrency=2', 'test/revert-regression.ts']); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  for (const mutation of mutations) {
    const path = join(root, 'src', mutation.file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(mutation.from));
    try {
      writeFileSync(path, original.replace(mutation.from, () => mutation.to)); const build = execute(['node_modules/typescript/bin/tsc']); assert.equal(build.status, 0, build.stdout + build.stderr);
      const result = execute(['--test', '--test-concurrency=2', '--test-name-pattern', mutation.test, 'test/revert-regression.ts']); assert.notEqual(result.status, 0, `Revert survived: ${mutation.name}`); assert.match(result.stdout, /(?:fail [1-9]|not ok)/); receipts.push({ mutation: mutation.name, regression_failed: true });
    } finally { writeFileSync(path, original); }
    assert.equal(execute(['node_modules/typescript/bin/tsc']).status, 0); const restored = execute(['--test', '--test-concurrency=2', '--test-name-pattern', mutation.test, 'test/revert-regression.ts']); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  }
  writeFileSync('revert-receipt.local.json', JSON.stringify({ baseline_passed: 8, mutations: receipts, all_restored_passed: true }, null, 2)); console.log(`revert-gate: 8 baseline tests; ${receipts.length} behavioral reverts failed and restored tests passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
