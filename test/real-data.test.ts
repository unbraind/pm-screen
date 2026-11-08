import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateCorpus, syntheticControls } from './corpus.ts';
const committed = JSON.parse(await readFile('docs/real-data-receipt.json', 'utf8')) as Awaited<ReturnType<typeof evaluateCorpus>> & { synthetic_controls: Awaited<ReturnType<typeof syntheticControls>> };
test('frozen public candidate sets retain exact declared judgments and ten resume answers', async () => { const receipt = await evaluateCorpus(); assert.equal(receipt.corpus.length, 3); assert.ok(receipt.resume_reduction_percent >= 50); const { synthetic_controls: _controls, ...expected } = committed; assert.deepEqual(receipt, expected, 'Committed public receipt must match regenerated evidence'); });
test('five aliases ten unavailable sources three disagreements and one changed source conserve counts', async () => { const receipt = await syntheticControls(); assert.equal(receipt.receipt.canonical_equals_disposition_sum, true); assert.equal(receipt.receipt.imported_equals_canonical_plus_aliases, true); assert.deepEqual(receipt, committed.synthetic_controls, 'Committed synthetic receipt must match regenerated evidence'); });
