import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { mapOutsideWebUris } from '../src/privacy.ts';
/** Fingerprint exact public bytes without recording source authors or credentials. */
export function hash(text: string | Uint8Array): string { return createHash('sha256').update(text).digest('hex'); }
/** Refuse secret-shaped public input and minimize paths outside public web URIs. */
export function safe(text: string): string {
  const minimized = mapOutsideWebUris(text, part => part.replace(/\/(?:home|Users)\/[^\s"'`<>]+/g, '[local path omitted]')).replace(/[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
  assert.equal(scanMutationSecrets(minimized).length, 0, 'Public source needs explicit privacy review'); return minimized;
}
/** Preserve absent issue bodies distinctly from every present string, including the word null. */
export function issueSnapshot(repo: string, row: { number: number; title: string; body: string | null; html_url: string }) {
  const raw = JSON.stringify({ title: row.title, body: row.body });
  const text = row.body === null ? row.title : `${row.title}\n${row.body}`;
  return { id: `${repo}-${row.number}`, url: row.html_url, title: safe(row.title), text: safe(text), body_state: row.body === null ? 'missing' as const : 'present' as const, content_digest: hash(raw), raw_bytes: Buffer.byteLength(raw) };
}
