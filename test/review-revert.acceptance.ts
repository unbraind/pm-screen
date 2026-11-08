import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { proveMutation, passingCount } from './revert-harness.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
const root = mkdtempSync(join(tmpdir(), 'screen-review-revert-'));
const env = testEnvironment(npmEnvironment(process.env)); const receipts = [];
/** Execute each proof with bounded workers in the disposable copy, never the reviewed checkout. */
function execute(args: string[]) { return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 }); }
const attribution = "const recorder = KeySchema.safeParse(host.author);\n    insist(recorder.success, 'invalid_input', 'Recorder attribution requires a compatible key', 'Select an author key of 1-96 ASCII letters, digits, underscores, periods, colons or hyphens, starting with a letter or digit; reserved prototype names are forbidden');\n    const state = structuredClone(snapshot.state); const result = apply(state, normalized, parse(KeySchema, recorder.data));";
const recorded = JSON.parse(readFileSync('docs/real-data-receipt.json', 'utf8')) as { corpus: { candidates: number; all_packet_bytes: number; completeness_receipt: { source_manifest_digest: string } }[]; synthetic_controls: { changed_sources: number } };
/** Mutate a measured receipt field without baking fixture-specific counts into the proof. */
function fieldValue(name: string, value: string | number): string { return `${JSON.stringify(name)}: ${JSON.stringify(value)}`; }
const first = recorded.corpus[0];
const mutations = [
  { name: 'null-body', file: 'scripts/corpus-input.ts', from: 'row.body === null ? row.title : `${row.title}\\n${row.body}`', to: '`${row.title}\\n${row.body}`', test: 'test/corpus-input.test.ts', pattern: 'issue acquisition', failure: /Public issue/ },
  { name: 'recorder-remedy', file: 'src/api.ts', from: attribution, to: 'const state = structuredClone(snapshot.state); const result = apply(state, normalized, parse(KeySchema, host.author));', test: 'test/review.test.ts', pattern: 'recorder key', failure: /Recorder attribution/ },
  { name: 'public-uri', file: 'src/privacy.ts', from: 'if (!URL.canParse(match[0])) continue;', to: 'if (Boolean(1)) continue;', test: 'test/privacy-policy.test.ts', pattern: 'shared private path policy', failure: /URI bytes must remain exact/ },
  { name: 'acquisition-uri', file: 'scripts/corpus-input.ts', from: "mapOutsideWebUris(text, part => mapPrivatePaths(part, () => '[local path omitted]'))", to: "text.replace(/\\/(?:home|Users)\\/[^\\s\"'`<>]+/g, '[local path omitted]')", test: 'test/corpus-input.test.ts', pattern: 'acquisition minimization', failure: /local path omitted/ },
  { name: 'identity-uri', file: 'src/privacy.ts', from: '(?<![\\w./-])', to: '', test: 'test/identity.test.ts', pattern: 'identity gate', failure: /Private path policy failed/ },
  { name: 'malformed-uri', file: 'src/schema.ts', from: 'if (!URL.canParse(value)) return false; ', to: '', test: 'test/review.test.ts', pattern: 'malformed public URIs', failure: /The host outcome could not be verified/ },
  { name: 'shared-private-policy', file: 'scripts/corpus-input.ts', from: "mapPrivatePaths(part, () => '[local path omitted]')", to: "part.replace(/\\/(?:home|Users)\\/[^\\s\"'`<>]+/g, '[local path omitted]')", test: 'test/privacy-policy.test.ts', pattern: 'shared private path policy', failure: /Shared private path minimization|Relative and public evidence/ },
  { name: 'stored-vector', file: 'src/kernel.ts', from: 'parse(VectorSchema, raw, stored)', to: 'parse(VectorSchema, raw)', test: 'test/review.test.ts', pattern: 'stored legacy text', failure: /Private paths/ },
  { name: 'stored-protocol', file: 'src/kernel.ts', from: 'parse(ProtocolSchema, rawProtocol, stored)', to: 'parse(ProtocolSchema, rawProtocol)', test: 'test/review.test.ts', pattern: 'stored legacy text', failure: /Private paths/ },
  { name: 'stored-next', file: 'src/api.ts', from: 'deriveEligibility(protocol, assessment.vector, true)', to: 'deriveEligibility(protocol, assessment.vector)', test: 'test/review.test.ts', pattern: 'stored legacy text', failure: /Private paths/ },
  { name: 'stored-output', file: 'src/output.ts', from: 'guardSubmitted(value.warnings)', to: 'guardSubmitted(value)', test: 'test/review.test.ts', pattern: 'stored legacy text', failure: /Private paths/ },
  { name: 'aggregate-scanning', file: 'src/privacy.ts', from: 'scanned <= 1048576', to: 'scanned >= 0', test: 'test/privacy-policy.test.ts', pattern: 'submission scanning', failure: /Aggregate submission scanning must be bounded/ },
  { name: 'home-punctuation', file: 'src/privacy.ts', from: "while (path[end - 1] === '.')", to: 'while (Boolean(0))', test: 'test/privacy-policy.test.ts', pattern: 'shared private path policy', failure: /Home aliases with punctuation must refuse/ },
  { name: 'measured-agreement', file: 'test/corpus.ts', from: 'input.sets.reduce((n, set) => n + set.rows.length, 0)', to: '87', test: 'test/audit.test.ts', pattern: 'corpus measurement', failure: /Agreement must count the evaluated corpus/ },
  { name: 'pure-evaluation', file: 'test/corpus.ts', from: '    return result;', to: "    process.getBuiltinModule('node:fs').writeFileSync('docs/real-data-receipt.json', JSON.stringify(result)); return result;", test: 'test/audit.test.ts', pattern: 'corpus measurement', failure: /Evaluation must never overwrite the complete receipt/ },
  { name: 'runtime-provisioning', file: '.github/workflows/release.yml', from: "bun-version: '1.3.5'", to: 'bun-version: latest', test: 'test/audit.test.ts', pattern: 'every CI and release runtime', failure: /Bun provisioning must pin the claimed version/ },
  { name: 'validated-string-cache', file: 'src/privacy.ts', from: 'if (validated.has(value)) return;', to: 'if (Boolean(0)) return;', test: 'test/privacy-policy.test.ts', pattern: 'submission scanning', failure: /Aggregate text scanning budget exceeded/ },
  { name: 'resolved-home', file: 'src/privacy.ts', from: '[homedir(), resolvedHome(homedir())]', to: '[homedir()]', test: 'test/privacy-policy.test.ts', pattern: 'home resolution', failure: /Resolved home paths must classify as private/ },
  { name: 'production-dynamic-import', file: 'test/corpus-privacy.test.ts', from: "assert.notEqual(node.type, 'ImportExpression', 'Dynamic production import');", to: 'void node;', test: 'test/corpus-privacy.test.ts', pattern: 'production import guard', failure: /Missing expected exception/ },
  { name: 'portable-path', file: 'scripts/consumer-tools.ts', from: "path.split(windows ? ';' : delimiter)", to: "path.split(delimiter)", test: 'test/audit.test.ts', pattern: 'linked consumer commands', failure: /Required consumer tool unavailable/ },
  { name: 'sdk-initialization', file: 'README.md', from: "await native.init('screening'", to: "await native.open('screening'", test: 'test/audit.test.ts', pattern: 'every CI and release runtime', failure: /SDK example must initialize a new tracker/ },
  // These three fault injections prove the new test assertions catch the advertised regressions.
  { name: 'resume-byte-oracle', file: 'test/corpus.ts', from: "const output = wire(fitEnvelope(host, envelope(packet)), 'toon');", to: "const output = wire(fitEnvelope(host, envelope(packet)), 'toon').padEnd(6401, ' ');", test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Resume packet exceeds/ },
  { name: 'freshness-state-oracle', file: 'src/api.ts', from: "  return bounded(host, { owner_id: owner.id, revision: owner.revision, protocol_digest:", to: "  await host.client.update(owner.id, { field: [`screen_state=${canonical({ ...owner.state, assessments: [] })}`] });\n  return bounded(host, { owner_id: owner.id, revision: owner.revision, protocol_digest:", test: 'test/real-data.test.ts', pattern: 'five aliases', failure: /Freshness inspection must preserve/ },
  { name: 'receipt-count-oracle', file: 'docs/real-data-receipt.json', from: fieldValue('candidates', first.candidates), to: fieldValue('candidates', first.candidates + 1), test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'receipt-bytes-oracle', file: 'docs/real-data-receipt.json', from: fieldValue('all_packet_bytes', first.all_packet_bytes), to: fieldValue('all_packet_bytes', first.all_packet_bytes + 1), test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'receipt-digest-oracle', file: 'docs/real-data-receipt.json', from: fieldValue('source_manifest_digest', first.completeness_receipt.source_manifest_digest), to: fieldValue('source_manifest_digest', '0'.repeat(64)), test: 'test/real-data.test.ts', pattern: 'frozen public', failure: /Committed public receipt must match/ },
  { name: 'synthetic-receipt-oracle', file: 'docs/real-data-receipt.json', from: fieldValue('changed_sources', recorded.synthetic_controls.changed_sources), to: fieldValue('changed_sources', recorded.synthetic_controls.changed_sources + 1), test: 'test/real-data.test.ts', pattern: 'five aliases', failure: /Committed synthetic receipt must match/ },
];
try {
  for (const path of ['src', 'scripts', 'test', 'docs', '.github', 'README.md', 'index.ts', 'package.json', 'tsconfig.json']) cpSync(path, join(root, path), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  assert.equal(execute(['node_modules/typescript/bin/tsc']).status, 0);
  const baseline = execute(['--test', '--test-concurrency=2', 'test/edge.test.ts', 'test/review.test.ts', 'test/corpus-input.test.ts', 'test/real-data.test.ts', 'test/identity.test.ts', 'test/privacy-policy.test.ts', 'test/audit.test.ts', 'test/corpus-privacy.test.ts']);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr); const baselinePassed = passingCount(baseline);
  for (const mutation of mutations) {
    proveMutation(root, mutation.file, mutation.from, mutation.to, ['--test', '--test-concurrency=2', '--test-name-pattern', mutation.pattern, mutation.test], execute, mutation.failure);
    receipts.push({ mutation: mutation.name, regression_failed: true });
    console.log(`review-revert: ${mutation.name} failed on defect and passed after restoration`);
  }
  writeFileSync('review-revert-receipt.local.json', JSON.stringify({ baseline_passed: baselinePassed, mutations: receipts, all_restored_passed: true }, null, 2));
  console.log(`review-revert-gate: ${baselinePassed} baseline tests; ${receipts.length} defects detected; all restored tests passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
