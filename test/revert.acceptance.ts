import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { proveMutation, passingCount } from './revert-harness.ts';
import { mutations } from './revert-mutations.ts';
import { npmEnvironment } from '../scripts/environment.ts';
const root = mkdtempSync(join(tmpdir(), 'screen-revert-')); const env = npmEnvironment(process.env); const receipts = [];
/** Run only in the disposable copy; all mutations are restored in finally. */
function execute(args: string[]) { return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }

try {
  for (const path of ['src', 'index.ts', 'package.json', 'tsconfig.json']) cpSync(path, join(root, path), { recursive: true }); mkdirSync(join(root, 'test'));
  for (const file of ['helpers.ts', 'revert-regression.ts']) cpSync(join('test', file), join(root, 'test', file)); symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  assert.equal(execute(['node_modules/typescript/bin/tsc']).status, 0); const baseline = execute(['--test', '--test-concurrency=2', 'test/revert-regression.ts']); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr); const baselinePassed = passingCount(baseline);
  for (const mutation of mutations) {
    proveMutation(root, `src/${mutation.file}`, mutation.from, mutation.to, ['--test', '--test-concurrency=2', '--test-name-pattern', mutation.test, 'test/revert-regression.ts'], execute, mutation.failure);
    receipts.push({ mutation: mutation.name, regression_failed: true });
  }
  writeFileSync('revert-receipt.local.json', JSON.stringify({ baseline_passed: baselinePassed, mutations: receipts, all_restored_passed: true }, null, 2)); console.log(`revert-gate: ${baselinePassed} baseline tests; ${receipts.length} behavioral reverts failed and restored tests passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
