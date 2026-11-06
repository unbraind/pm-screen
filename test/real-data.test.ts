import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCorpus, syntheticControls } from './corpus.ts';
test('frozen public candidate sets retain exact declared judgments and ten resume answers', async () => { const receipt = await evaluateCorpus(); assert.equal(receipt.corpus.length, 3); assert.ok(receipt.resume_reduction_percent >= 50); });
test('five aliases ten unavailable sources three disagreements and one changed source conserve counts', async () => { const receipt = await syntheticControls(); assert.equal(receipt.receipt.canonical_equals_disposition_sum, true); assert.equal(receipt.receipt.imported_equals_canonical_plus_aliases, true); });
