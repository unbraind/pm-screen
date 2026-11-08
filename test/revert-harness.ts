import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/** Captured subprocess evidence distinguishes assertion failures from launch or build failures. */
interface Result { /** Process exit status. */ status: number | null; /** Standard output. */ stdout: string; /** Standard error. */ stderr: string; }
/** Prove one behavioral defect fails, restore exact source in finally, then prove the fixed test passes. */
export function proveMutation(root: string, file: string, from: string, to: string, args: string[], execute: (args: string[]) => Result, failure: RegExp): void {
  const path = join(root, file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(from), `Missing mutation anchor in ${file}`);
  /** Every production mutation must still compile before the regression is exercised. */
  const build = () => { const result = execute(['node_modules/typescript/bin/tsc']); assert.equal(result.status, 0, result.stdout + result.stderr); };
  const baseline = execute(args); passingCount(baseline);
  try {
    writeFileSync(path, original.replace(from, () => to)); build();
    const result = execute(args); assert.equal(result.status, 1, `Expected test assertion failure in ${file}\n${result.stdout}${result.stderr}`);
    const output = result.stdout + result.stderr;
    const named = args[args.indexOf('--test-name-pattern') + 1];
    assert.ok(output.split('\n').some(line => /^(?:not ok \d+ - |✖ )/.test(line) && line.includes(named)), 'The named regression must fail');
    assert.match(output, failure);
  } finally { writeFileSync(path, original); }
  build(); passingCount(execute(args));
}

/** Derive nonzero proof counts from a successful runner receipt rather than a literal. */
export function passingCount(result: Result): number {
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  const match = output.match(/^(?:ℹ |# )pass (\d+)\s*$/m);
  assert.ok(match && Number(match[1]) > 0, 'Passing baseline must execute tests');
  return Number(match[1]);
}
