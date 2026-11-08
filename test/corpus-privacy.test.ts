import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { runtimeSources } from '../scripts/inventory.ts';
import { mapOutsideWebUris, mapPrivatePaths } from '../dist/src/privacy.js';

const forbidden = ['pm-observer', 'pm-web-hosted', 'pm-gpt'];
/** Guard minimized public fixtures without reading the named private repositories. */
function publicText(text: string): void {
  for (const name of forbidden) assert.ok(!new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'i').test(text), 'Private repository citation');
  mapOutsideWebUris(text, part => mapPrivatePaths(part, () => { throw new Error('Private path'); })); assert.equal(scanMutationSecrets(text).length, 0);
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
  const actual: string[] = []; const imports = new Set(['node:assert/strict', 'node:fs/promises', 'node:path', 'node:os', 'node:child_process', 'node:crypto', '@unbrained/pm-cli/sdk', './environment.ts', './corpus-input.ts']);
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
  for (const file of ['scripts/acquire-corpus.ts', 'scripts/corpus-input.ts', 'test/corpus.ts', 'test/fixtures/public-corpus.json', 'test/fixtures/expected-decisions.json', 'test/fixtures/search-hits.json', 'docs/real-data-receipt.json']) publicText(await readFile(file, 'utf8'));
  for (const name of forbidden) { assert.throws(() => publicText(`https://github.com/example/${name}`), /Private repository/); assert.throws(() => publicText(name.toUpperCase()), /Private repository/); publicText(`${name}-tools`); }
  publicText('https://example.org/' + ['users', 'public', 'artifact'].join('/'));
  assert.throws(() => publicText('/' + ['home', 'example', 'file'].join('/')), /Private path/);
});

test('acquisition cannot drift into canonical/private trackers or arbitrary network endpoints', async () => {
  const source = await readFile('scripts/acquire-corpus.ts', 'utf8'); readBoundaries(source);
  for (const bad of [source + "\nawait readFile('../unapproved/README.md', 'utf8');", source.replace('cwd: copy', 'cwd: process.cwd()'), source.replace("repo: 'pm-csv'", "repo: 'unapproved'"), source.replace('https://codeload.github.com', 'https://example.org'), source + "\nawait import('node:fs');"]) assert.throws(() => readBoundaries(bad));
});

/** Audit every production module without executing imports or network capabilities. */
function productionBoundaries(source: string, file = 'index.ts'): void {
  const inventory = new Set(runtimeSources().map(path => path.replaceAll(String.fromCharCode(92), '/')));
  const modules = new Set(['zod', '@toon-format/toon', '@unbrained/pm-cli/sdk', '@unbrained/pm-cli/sdk/core', '@unbrained/pm-cli/sdk/authoring', 'node:crypto', 'node:fs', 'node:os']);
  const restricted = new Map([['node:fs', 'realpathSync'], ['node:os', 'homedir'], ['node:crypto', 'createHash']]);
  walk(parse(source, { sourceType: 'module', plugins: ['typescript'] }), node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(node.type)) && node.source) {
      const name = (node.source as { value: string }).value;
      const relative = posix.normalize(posix.join(posix.dirname(file), name));
      assert.ok(name.startsWith('./') ? inventory.has(relative) : modules.has(name), 'Unreviewed production import');
      if (restricted.has(name)) for (const specifier of node.specifiers as { imported?: { name: string } }[]) assert.equal(specifier.imported?.name, restricted.get(name), 'Unreviewed filesystem capability');
    }
    assert.notEqual(node.type, 'ImportExpression', 'Dynamic production import');
    if (['MemberExpression', 'OptionalMemberExpression'].includes(String(node.type))) {
      const property = node.property as { type: string; name?: string; value?: string };
      if (node.computed && ['globalThis', 'global', 'module', 'window'].includes((node.object as { name?: string }).name ?? '')) assert.equal(property.type, 'StringLiteral', 'Computed production capability');
      assert.ok(!['import', 'require', 'getBuiltinModule', 'fetch', 'eval', 'Function'].includes(property.name ?? property.value ?? ''), 'Unreviewed production member capability');
    }
    if (['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(String(node.type))) {
      const callee = node.callee as { type: string; name?: string; property?: { name?: string; value?: string } };
      const name = callee.property?.name ?? callee.property?.value ?? callee.name ?? callee.type;
      assert.ok(!['Import', 'import', 'require', 'getBuiltinModule', 'fetch', 'eval', 'Function', 'exec', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'readFile', 'readFileSync'].includes(name), 'Unreviewed production capability');
    }
  });
}

test('production import guard covers all modules plus member optional and dynamic capabilities', async () => {
  for (const file of runtimeSources()) productionBoundaries(await readFile(file, 'utf8'), file);
  for (const code of ["import 'node:child_process';", "import './scripts/acquire-corpus.ts';", "globalThis['fe'+'tch']('https://example.org');", "const load = module.require;", "process.getBuiltinModule('node:fs');", "import {readFileSync} from 'node:fs';", "await import('node:fs');", "require('node:fs');", "module.require('node:fs');", "module?.require?.('node:fs');", "globalThis['fetch']?.('https://example.org');", "globalThis.fetch('https://example.org');"]) assert.throws(() => productionBoundaries(code), /production|filesystem/);
  productionBoundaries("const inert = 'import(never-executed)';");
});
