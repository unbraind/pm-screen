import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { guardSubmitted, mapPrivatePaths, mapOutsideWebUris, resolvedHome } from '../dist/src/privacy.js';
import { safe, issueSnapshot, hash } from '../scripts/corpus-input.ts';
import { hasCode } from './helpers.ts';

import { privateCases } from './path-cases.ts';

test('shared private path policy preserves relative evidence and classifies punctuated home aliases', () => {
  const uri = 'https://example.org/users/Public/home';
  assert.equal(mapOutsideWebUris(`See ${uri} now`, text => text.toUpperCase()), `SEE ${uri} NOW`, 'URI bytes must remain exact');
  const allowed = ['src/home/index.ts', 'components/Users/List.tsx', 'root-cause', 'homework', '/root-cause', 'https://example.org/users/public/home'];
  for (const text of allowed) { guardSubmitted(text); assert.equal(safe(text), text, 'Relative and public evidence must remain exact'); }
  for (const path of [...privateCases(), homedir(), homedir() + '/child', resolvedHome(homedir())]) for (const dots of ['', '.', '...', '.'.repeat(800)]) {
    const value = `See ${path}${dots}`;
    assert.throws(() => guardSubmitted(value), hasCode('invalid_input'), 'Home aliases with punctuation must refuse');
    assert.equal(safe(value), 'See [local path omitted]', 'Shared private path minimization');
    const row = { number: 1, title: 'Public evidence', body: value, html_url: 'https://example.org/issues/1' };
    assert.equal(issueSnapshot('public-package', row).content_digest, hash(JSON.stringify({ title: row.title, body: row.body })), 'Raw source digest must survive minimization');
    assert.notEqual(mapOutsideWebUris(value, text => mapPrivatePaths(text, () => 'redacted')), value);
  }
  assert.equal(mapPrivatePaths('$HOME', () => 'redacted', false), '$HOME');
  assert.equal(safe('Public\u001btext'), 'Publictext');
});

test('home resolution covers symlink targets and unavailable directories without reading home contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-home-'));
  try { const target = join(root, 'target'); mkdirSync(target); const alias = join(root, 'alias'); symlinkSync(target, alias, 'dir'); assert.equal(resolvedHome(alias), target);
    const code = `import assert from 'node:assert/strict'; import {guardSubmitted} from ${JSON.stringify(new URL('../dist/src/privacy.js', import.meta.url).href)}; for (const path of ${JSON.stringify([alias, target])}) for (const dots of ['', '...']) assert.throws(() => guardSubmitted(path + dots), /Private paths/);`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...testEnvironment(npmEnvironment(process.env)), HOME: alias }, encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, 'Resolved home paths must classify as private: ' + run.stderr);
    const missing = join(root, 'missing'); assert.equal(resolvedHome(missing), missing); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('submission scanning bounds distinct text and caches fully checked repeated strings', () => {
  const repeated = 'Public text '.repeat(600); guardSubmitted(Array.from({ length: 1000 }, () => repeated));
  assert.throws(() => guardSubmitted(Array.from({ length: 150 }, (_, i) => `${i} ${'a'.repeat(7900)}`)), /Aggregate text scanning budget exceeded/, 'Aggregate submission scanning must be bounded');
  for (const value of ['safe', 'ghp_' + 'A'.repeat(36)]) {
    if (value === 'safe') guardSubmitted([value, value]); else assert.throws(() => guardSubmitted([value, value]), hasCode('invalid_input'));
  }
});
