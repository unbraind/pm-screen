import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { proveMutation } from './revert-harness.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
const root = mkdtempSync(join(tmpdir(), 'screen-review-revert-'));
const env = testEnvironment(npmEnvironment(process.env)); const receipts = [];
/** Execute each proof with bounded workers in the disposable copy, never the reviewed checkout. */
function execute(args: string[]) { return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 }); }
const attribution = "const recorder = KeySchema.safeParse(host.author);\n    insist(recorder.success, 'invalid_input', 'Recorder attribution requires a compatible key', 'Select an author key of 1-96 ASCII letters, digits, underscores, periods, colons or hyphens, starting with a letter or digit; reserved prototype names are forbidden');\n    const state = structuredClone(snapshot.state); const result = apply(state, normalized, parse(KeySchema, recorder.data));";
const mutations = [
  { name: 'null-body', file: 'scripts/corpus-input.ts', from: 'row.body === null ? row.title : `${row.title}\\n${row.body}`', to: '`${row.title}\\n${row.body}`', test: 'test/corpus-input.test.ts', pattern: 'issue acquisition', failure: /Public issue/ },
  { name: 'recorder-remedy', file: 'src/api.ts', from: attribution, to: 'const state = structuredClone(snapshot.state); const result = apply(state, normalized, parse(KeySchema, host.author));', test: 'test/review.test.ts', pattern: 'recorder key', failure: /Recorder attribution/ },
  { name: 'public-uri', file: 'src/privacy.ts', from: 'if (!URL.canParse(match[0])) continue;', to: 'if (Boolean(1)) continue;', test: 'test/edge.test.ts', pattern: 'strict privacy', failure: /Private paths/ },
  { name: 'acquisition-uri', file: 'scripts/corpus-input.ts', from: "mapOutsideWebUris(text, part => part.replace(/\\/(?:home|Users)\\/[^\\s\"'`<>]+/g, '[local path omitted]'))", to: "text.replace(/\\/(?:home|Users)\\/[^\\s\"'`<>]+/g, '[local path omitted]')", test: 'test/corpus-input.test.ts', pattern: 'acquisition minimization', failure: /local path omitted/ },
  { name: 'identity-uri', file: 'scripts/identity-gate.ts', from: '(?<![\\w.-])', to: '', test: 'test/identity.test.ts', pattern: 'identity gate', failure: /Private path policy failed/ },
  { name: 'malformed-uri', file: 'src/schema.ts', from: 'if (!URL.canParse(value)) return false; ', to: '', test: 'test/review.test.ts', pattern: 'malformed public URIs', failure: /The host outcome could not be verified/ },
  // These three fault injections prove the new test assertions catch the advertised regressions.
  { name: 'resume-byte-oracle', file: 'test/corpus.ts', from: "const output = wire(fitEnvelope(host, envelope(packet)), 'toon');", to: "const output = wire(fitEnvelope(host, envelope(packet)), 'toon').padEnd(6401, ' ');", test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Resume packet exceeds/ },
  { name: 'freshness-state-oracle', file: 'src/api.ts', from: "  return bounded(host, { owner_id: owner.id, revision: owner.revision, protocol_digest:", to: "  await host.client.update(owner.id, { field: [`screen_state=${canonical({ ...owner.state, assessments: [] })}`] });\n  return bounded(host, { owner_id: owner.id, revision: owner.revision, protocol_digest:", test: 'test/real-data.test.ts', pattern: 'five aliases', failure: /Freshness inspection must preserve/ },
  { name: 'receipt-count-oracle', file: 'docs/real-data-receipt.json', from: '"candidates": 5,', to: '"candidates": 6,', test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'receipt-bytes-oracle', file: 'docs/real-data-receipt.json', from: '"all_packet_bytes": 16992,', to: '"all_packet_bytes": 16993,', test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'receipt-digest-oracle', file: 'docs/real-data-receipt.json', from: '"source_manifest_digest": "fa54a62b5cea8ed43a6df0f5cb346b2dc732437595225fa8079a52687ba074fc"', to: '"source_manifest_digest": "' + '0'.repeat(64) + '"', test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'synthetic-receipt-oracle', file: 'docs/real-data-receipt.json', from: '"changed_sources": 1,', to: '"changed_sources": 2,', test: 'test/real-data.test.ts', pattern: 'five aliases', failure: /Committed synthetic receipt must match/ },
];
try {
  for (const path of ['src', 'scripts', 'test', 'docs', '.github', 'index.ts', 'package.json', 'tsconfig.json']) cpSync(path, join(root, path), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  assert.equal(execute(['node_modules/typescript/bin/tsc']).status, 0);
  const baseline = execute(['--test', '--test-concurrency=2', 'test/edge.test.ts', 'test/review.test.ts', 'test/corpus-input.test.ts', 'test/real-data.test.ts', 'test/identity.test.ts']);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  for (const mutation of mutations) {
    proveMutation(root, mutation.file, mutation.from, mutation.to, ['--test', '--test-concurrency=2', '--test-name-pattern', mutation.pattern, mutation.test], execute, mutation.failure);
    receipts.push({ mutation: mutation.name, regression_failed: true });
    console.log(`review-revert: ${mutation.name} failed on defect and passed after restoration`);
  }
  writeFileSync('review-revert-receipt.local.json', JSON.stringify({ baseline_passed: 16, mutations: receipts, all_restored_passed: true }, null, 2));
  console.log(`review-revert-gate: 16 baseline tests; ${receipts.length} defects detected; all restored tests passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
