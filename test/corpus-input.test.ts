import test from 'node:test';
import assert from 'node:assert/strict';
import { issueSnapshot, safe, hash } from '../scripts/corpus-input.ts';

test('issue acquisition distinguishes missing bodies from literal null and preserves present body bytes', () => {
  const row = { number: 1, title: 'Public issue', html_url: 'https://example.org/issues/1' };
  const missing = issueSnapshot('public-package', { ...row, body: null });
  const literal = issueSnapshot('public-package', { ...row, body: 'null' });
  assert.equal(missing.body_state, 'missing'); assert.equal(missing.text, row.title);
  assert.equal(literal.body_state, 'present'); assert.equal(literal.text, `${row.title}\nnull`);
  assert.notEqual(missing.content_digest, literal.content_digest);
  for (const body of ['', '  body\nwith interior whitespace\r\n']) {
    const actual = issueSnapshot('public-package', { ...row, body }); const raw = JSON.stringify({ title: row.title, body });
    assert.equal(actual.body_state, 'present'); assert.equal(actual.text, `${row.title}\n${body}`);
    assert.equal(actual.content_digest, hash(raw)); assert.equal(actual.raw_bytes, Buffer.byteLength(raw));
  }
});

test('acquisition minimization preserves public URI paths while removing surrounding private paths', () => {
  const uri = 'https://example.org/' + ['users', 'public', 'home', 'root-cause'].join('/');
  const privatePath = '/' + ['home', 'example', 'secret'].join('/');
  assert.equal(safe(`See ${uri} and ${privatePath}`), `See ${uri} and [local path omitted]`);
  assert.equal(safe(`See ${uri}"${privatePath}`), `See ${uri}"[local path omitted]`);
  assert.equal(safe('  exact public text\n'), '  exact public text\n');
  assert.throws(() => safe('ghp_' + 'A'.repeat(36)), /privacy review/);
});
