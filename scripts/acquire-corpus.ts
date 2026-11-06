import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PmClient, certifyCompleteListResult, scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { npmEnvironment } from './environment.ts';
/** The only source repositories allowed into acquisition, all verified public. */
export const publicTrackers = [
  { repo: 'pm-csv', revision: '6810408d561f657fa495d121b094eb52735f2c67' },
  { repo: 'pm-beads', revision: '85b6392112929e967dfb5e174c773a0590124c35' },
  { repo: 'pm-ops', revision: '274c15895a88a12bec3d154a7a0ebf61e014b799' },
  { repo: 'pm-brief', revision: '283df04e37bf3144c1beb7026918b774495768ed' },
] as const;
/** Fingerprint exact public bytes without recording source authors or credentials. */
function hash(text: string | Uint8Array): string { return createHash('sha256').update(text).digest('hex'); }
/** Refuse secret-shaped public input and minimize any published local path references. */
function safe(text: string): string {
  assert.equal(scanMutationSecrets(text).length, 0, 'Public source needs explicit privacy review');
  return text.replace(/\/(?:home|Users)\/[^\s"'`<>]+/g, '[local path omitted]').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}
/** Freeze public snapshots into disposable copies, never reading canonical fleet trackers. */
async function acquire() {
  const policy = await readFile('docs/policy-examples.md', 'utf8'); const scratch = await mkdtemp(join(tmpdir(), 'screen-public-'));
  const items: { repo: string; revision: string; id: string; item_hash: string; raw_bytes: number; content_digest: string; text: string; title: string }[] = [];
  const receipts: { repo: string; revision: string; total: number; selected: string[]; archive_sha256: string }[] = [];
  try {
    for (const { repo, revision } of publicTrackers) {
      const metadata = await fetch(`https://api.github.com/repos/unbraind/${repo}`); assert.ok(metadata.ok); const meta = await metadata.json() as { private: boolean }; assert.equal(meta.private, false);
      const response = await fetch(`https://codeload.github.com/unbraind/${repo}/tar.gz/${revision}`); assert.ok(response.ok); const archive = Buffer.from(await response.arrayBuffer());
      const copy = join(scratch, repo); await mkdir(copy);
      execFileSync('tar', ['-xz', '--strip-components=1', '--wildcards', '-C', copy, '*/.agents/pm/*'], { input: archive, env: npmEnvironment(process.env) });
      const client = new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true }); const corpus = certifyCompleteListResult(await client.listAllComplete({ includeBody: true }));
      const selected = corpus.items.map(row => row.id).sort().slice(0, 20); assert.equal(selected.length, 20);
      for (const id of selected) {
        const got = await client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' }); assert.ok('item' in got && 'item_hash' in got);
        const { item } = got; const text = [item.title, item.description, item.body, ...(item.comments ?? []).map(c => c.text)].filter(Boolean).join('\n');
        items.push({ repo, revision, id, item_hash: String(got.item_hash), raw_bytes: Buffer.byteLength(JSON.stringify(item)), content_digest: hash(JSON.stringify(item)), text: safe(text), title: safe(item.title ?? item.id) });
      }
      receipts.push({ repo, revision, total: corpus.complete_list.item_count, selected, archive_sha256: hash(archive) });
    }
    const issues: { id: string; url: string; title: string; text: string; content_digest: string; raw_bytes: number }[] = [];
    const issueReceipts = [];
    for (const repo of ['pm-csv', 'pm-beads', 'pm-brief']) {
      let page = 1; let exhausted = false; let count = 0;
      while (!exhausted) {
        const response = await fetch(`https://api.github.com/repos/unbraind/${repo}/issues?state=open&per_page=100&page=${page}`); assert.ok(response.ok);
        const rows = await response.json() as { number: number; title: string; body: string; html_url: string; pull_request?: unknown }[];
        for (const row of rows.filter(row => !row.pull_request)) { const text = `${row.title}\n${row.body}`; issues.push({ id: `${repo}-${row.number}`, url: row.html_url, title: safe(row.title), text: safe(text), content_digest: hash(text), raw_bytes: Buffer.byteLength(JSON.stringify({ title: row.title, body: row.body })) }); count++; }
        exhausted = !response.headers.get('link')?.includes('rel="next"'); page++;
      }
      issueReceipts.push({ repo, count, pages: page - 1, pagination_exhausted: exhausted });
    }
    await writeFile('corpus-review.local.json', JSON.stringify({ captured_at: new Date().toISOString(), policy_digest: hash(policy), tracker_receipts: receipts, issue_receipts: issueReceipts, items, issues }, null, 2) + '\n');
    console.log(JSON.stringify({ trackers: receipts.map(r => ({ repo: r.repo, total: r.total, selected: r.selected.length })), issues: issueReceipts, policy_digest: hash(policy) }));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
await acquire();
