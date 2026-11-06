import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';

const forbidden = ['pm-observer', 'pm-web-hosted', 'pm-gpt'];
/** Guard minimized public fixtures without reading the named private repositories. */
function publicText(text: string): void {
  for (const name of forbidden) assert.ok(!new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'i').test(text), 'Private repository citation');
  assert.ok(!/\/(?:home|Users)\//.test(text), 'Private path'); assert.equal(scanMutationSecrets(text).length, 0);
}
/** Walk syntax without executing acquisition or dynamic imports. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const node of value) walk(node, visit); return; }
  if (value === null || typeof value !== 'object') return; const object = value as Record<string, unknown>;
  if (typeof object.type === 'string') visit(object);
  for (const [key, child] of Object.entries(object)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) walk(child, visit);
}
/** Restrict the acquisition program to exact public endpoints and disposable tracker roots. */
function readBoundaries(source: string): void {
  const expected = new Set([
    "fetch(`https://api.github.com/repos/unbraind/${repo}`)",
    "fetch(`https://codeload.github.com/unbraind/${repo}/tar.gz/${revision}`)",
    "fetch(`https://api.github.com/repos/unbraind/${repo}/issues?state=open&per_page=100&page=${page}`)",
    "readFile('docs/policy-examples.md', 'utf8')",
    "new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true })",
    "execFileSync('tar', ['-xz', '--strip-components=1', '--wildcards', '-C', copy, '*/.agents/pm/*'], { input: archive, env: npmEnvironment(process.env) })",
  ]);
  const actual: string[] = []; const imports = new Set(['node:assert/strict', 'node:fs/promises', 'node:path', 'node:os', 'node:child_process', 'node:crypto', '@unbrained/pm-cli/sdk', './environment.ts']);
  walk(parse(source, { sourceType: 'module', plugins: ['typescript'] }), node => {
    if (node.type === 'ImportDeclaration') assert.ok(imports.has((node.source as { value: string }).value), 'Unreviewed import');
    assert.ok(node.type !== 'ImportExpression', 'Dynamic import');
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee as { name?: string; type: string }; assert.ok(!['require', 'eval', 'Function', 'Import'].includes(callee.name ?? callee.type), 'Dynamic capability');
      if (['fetch', 'readFile', 'PmClient', 'execFileSync'].includes(callee.name ?? '')) actual.push(source.slice(node.start as number, node.end as number));
    }
  });
  assert.deepEqual(new Set(actual), expected, 'Unreviewed read boundary'); assert.equal(actual.length, expected.size);
  assert.match(source, /const copy = join\(scratch, repo\)/); assert.match(source, /assert.equal\(meta.private, false\)/);
  const repos = [...source.matchAll(/repo: '([^']+)'/g)].map(match => match[1]); assert.deepEqual(repos, ['pm-csv', 'pm-beads', 'pm-ops', 'pm-brief']);
  assert.match(source, /for \(const repo of \['pm-csv', 'pm-beads', 'pm-brief'\]\)/);
}

test('public fixture guard rejects private citations and credential/path canaries', async () => {
  for (const file of ['scripts/acquire-corpus.ts', 'test/corpus.ts', 'test/fixtures/public-corpus.json', 'test/fixtures/expected-decisions.json', 'test/fixtures/search-hits.json', 'docs/real-data-receipt.json']) publicText(await readFile(file, 'utf8'));
  for (const name of forbidden) { assert.throws(() => publicText(`https://github.com/example/${name}`), /Private repository/); assert.throws(() => publicText(name.toUpperCase()), /Private repository/); publicText(`${name}-tools`); }
  assert.throws(() => publicText('/' + ['home', 'example', 'file'].join('/')), /Private path/);
});

test('acquisition cannot drift into canonical/private trackers or arbitrary network endpoints', async () => {
  const source = await readFile('scripts/acquire-corpus.ts', 'utf8'); readBoundaries(source);
  for (const bad of [source + "\nawait readFile('../unapproved/README.md', 'utf8');", source.replace('cwd: copy', 'cwd: process.cwd()'), source.replace("repo: 'pm-csv'", "repo: 'unapproved'"), source.replace('https://codeload.github.com', 'https://example.org'), source + "\nawait import('node:fs');"]) assert.throws(() => readBoundaries(bad));
});
