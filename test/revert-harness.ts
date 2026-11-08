import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/** Captured subprocess evidence distinguishes assertion failures from launch or build failures. */
interface Result { /** Process exit status. */ status: number | null; /** Standard output. */ stdout: string; /** Standard error. */ stderr: string; }
/** Prove one behavioral defect fails, restore exact source in finally, then prove the fixed test passes. */
export function proveMutation(root: string, file: string, from: string, to: string, args: string[], execute: (args: string[]) => Result, failure?: RegExp): void {
  const path = join(root, file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(from), `Missing mutation anchor in ${file}`);
  /** Every production mutation must still compile before the regression is exercised. */
  const build = () => { const result = execute(['node_modules/typescript/bin/tsc']); assert.equal(result.status, 0, result.stdout + result.stderr); };
  try {
    writeFileSync(path, original.replace(from, () => to)); build();
    const result = execute(args); assert.equal(result.status, 1, `Expected test assertion failure in ${file}\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout + result.stderr, failure ?? /(?:fail [1-9]|not ok)/);
  } finally { writeFileSync(path, original); }
  build(); const restored = execute(args); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
}
