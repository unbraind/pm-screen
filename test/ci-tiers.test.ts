import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parseDocument } from 'yaml';

/** Reject duplicate YAML keys rather than silently accepting overwritten gates. */
function workflow(name: string) {
  const document = parseDocument(readFileSync(`.github/workflows/${name}`, 'utf8'), { strict: true, uniqueKeys: true });
  assert.deepEqual(document.errors, [], name);
  return document.toJS();
}

test('all workflow YAML parses strictly with unique keys', () => {
  for (const name of readdirSync('.github/workflows').filter(name => /\.ya?ml$/u.test(name))) workflow(name);
});

test('deep gives every runtime and launcher pair one full release gate', () => {
  const deep = workflow('ci-deep.yml').jobs.deep;
  const matrix = deep.strategy.matrix;
  assert.deepEqual(matrix['node-version'], ['22.19.0', '26.0.0']);
  assert.deepEqual(matrix['package-manager'], ['npm', 'bun']);
  assert.deepEqual(matrix.include, [{ 'node-version': '22.19.0', major: 22 }, { 'node-version': '26.0.0', major: 26 }]);
  assert.equal(deep.name, 'deep (${{ matrix.major }}, ${{ matrix.package-manager }})');
  assert.equal(deep['timeout-minutes'], 120);
  assert.equal(deep.env.PM_TEST_DEPTH, 'full');
  assert.equal(deep.env.PM_TEST_TIME_SCALE, 3);
  const gates = deep.steps.filter((step: { run?: string }) => step.run?.endsWith('run release:check'));
  assert.equal(gates.length, 2);
  for (const launcher of matrix['package-manager']) {
    const selected = gates.filter((step: { if?: string }) => step.if === `matrix.package-manager == '${launcher}'`);
    assert.equal(selected.length, 1, `${launcher} must run exactly one gate`);
    assert.equal(selected[0].run, `${launcher} run release:check`);
    assert.match(selected[0].name, /Node release gate/u);
  }
  const docs = readFileSync('docs/ci-tiers.md', 'utf8');
  assert.match(docs, /both launcher legs prove the full Node suite and Node coverage/u);
});

test('documentation and tracker changes keep their health, identity, privacy and package gates', () => {
  const steps = workflow('ci.yml').jobs.test.steps;
  assert.ok(steps.some((step: { run?: string; if?: string }) => step.run === 'npm run tracker:health' && step.if === undefined));
  const docs = steps.find((step: { name: string }) => step.name === 'Documentation and tracker gates');
  assert.equal(docs.if, "steps.changes.outputs.code != 'true'");
  for (const command of ['./node_modules/.bin/pm health --strict-exit', 'npm run identity:check', 'npm run changelog:check', 'npm run verify:release-publish-attestation', 'npm run pack:dry-run', 'test/identity.test.ts', 'test/privacy-policy.test.ts', 'test/corpus-privacy.test.ts', 'test/audit.test.ts', 'test/real-data.test.ts']) {
    assert.ok(docs.run.includes(command), command);
  }
});
