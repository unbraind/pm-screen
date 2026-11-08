import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proveMutation } from './revert-harness.ts';
import { mutations } from './revert-mutations.ts';

test('revert evidence refuses unrelated named failures for every original mutation and restores source', () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-proof-oracle-')); const path = join(root, 'fixture.ts');
  try {
    for (const mutation of mutations) {
      writeFileSync(path, 'fixed');
      /** Simulate a successful build and baseline followed by an unrelated named test failure. */
      const execute = (args: string[]) => args[0] === 'node_modules/typescript/bin/tsc' || readFileSync(path, 'utf8') === 'fixed'
        ? { status: 0, stdout: '# pass 1\n', stderr: '' }
        : { status: 1, stdout: `not ok 1 - ${mutation.test}\nError: unrelated fixture failure\n`, stderr: '' };
      assert.throws(() => proveMutation(root, 'fixture.ts', 'fixed', 'broken', ['--test-name-pattern', mutation.test], execute, mutation.failure), /did not match/, 'Unrelated failures must never certify a behavioral revert');
      assert.throws(() => proveMutation(root, 'fixture.ts', 'fixed', 'broken', ['--test-name-pattern', mutation.test], execute, /revert/), /Failure oracle must not match the test name/, 'Test names cannot serve as failure causes');
      assert.equal(readFileSync(path, 'utf8'), 'fixed', 'Rejected proof must restore source');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
