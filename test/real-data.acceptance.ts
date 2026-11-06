import { writeFile } from 'node:fs/promises';
import { evaluateCorpus, syntheticControls } from './corpus.ts';
const receipt = await evaluateCorpus(); const controls = await syntheticControls();
await writeFile('docs/real-data-receipt.json', JSON.stringify({ ...receipt, synthetic_controls: controls }, null, 2) + '\n');
console.log(JSON.stringify({ corpus: receipt.corpus.map(row => ({ key: row.key, candidates: row.candidates, counts: row.counts, packet_tokens: row.all_packet_estimated_tokens, raw_tokens: row.raw_estimated_tokens })), resume_reduction_percent: receipt.resume_reduction_percent, synthetic: controls }));
