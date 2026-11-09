import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { insist, ScreeningRefusal } from './errors.ts';
/** Stable JSON identity ignores object key order, but preserves array order and exact text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** SHA-256 content identity for source, requests and results. */
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
/** Transform surrounding text while preserving parseable web URI bytes as inert data. */
export function mapOutsideWebUris(value: string, transform: (text: string) => string): string {
  let end = 0; let result = '';
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s"'`<>\\]+/giu)) {
    if (!URL.canParse(match[0])) continue;
    result += transform(value.slice(end, match.index)) + match[0]; end = match.index + match[0].length;
  }
  return result + transform(value.slice(end));
}
/** Resolve a home alias without requiring the directory to exist. */
export function resolvedHome(home: string): string {
  try { return realpathSync(home); } catch { return home; }
}
const homes = [...new Set([homedir(), resolvedHome(homedir())])].map(home => home.replaceAll(String.fromCharCode(92), '/'));
/** Shared filesystem token policy; URI mapping is applied by every caller. */
export function mapPrivatePaths(text: string, replace: (path: string) => string, homeAliases = true): string {
  return text.replace(/(?<![\w./-])(?:file:\/\/[\\/]|[a-z]:[\\/]|[\\/]|~|\$HOME\b|\$\{HOME\}|%USERPROFILE%)[^\s"'`<>()[\]{},;]*/giu, path => {
    let end = path.length;
    while (path[end - 1] === '.') end--;
    const bare = path.slice(0, end).replace(/^file:\/\//iu, '').replaceAll(String.fromCharCode(92), '/').replace(/^\/+/, '/');
    const alias = /^(?:[\\/](?:home|users|root)[\\/]|[\\/]mnt[\\/][a-z][\\/]users(?:[\\/]|$)|[a-z]:[\\/]users(?:[\\/]|$))/iu.test(bare);
    const shellAlias = homeAliases && /^(?:[\\/](?:home|users|root)|~|\$(?:HOME|\{HOME\})|%USERPROFILE%)(?:[\\/]|$)/iu.test(bare);
    const actual = homes.some(home => bare === home || bare.startsWith(home + '/'));
    return alias || shellAlias || actual ? replace(path) : path;
  });
}
/** Refuse unsafe data with bounded aggregate scanning and fully validated string caching. */
export function guardSubmitted(value: unknown): void {
  const seen = new Set<object>(); const validated = new Set<string>(); let scanned = 0; let nodes = 0;
  /** Visit plain JSON data without invoking getters or accepting cyclic graphs. */
  function visit(value: unknown, depth: number): void {
    insist(++nodes <= 262144, 'invalid_input', 'Aggregate node scanning budget exceeded');
    insist(depth <= 16, 'invalid_input', 'Input nesting exceeds sixteen levels');
    if (typeof value === 'string') {
      if (validated.has(value)) return;
      scanned += value.length;
      insist(scanned <= 1048576, 'invalid_input', 'Aggregate text scanning budget exceeded');
      insist(value.length <= 8000 && value.isWellFormed(), 'invalid_input', 'Text is oversized or malformed Unicode');
      insist(!/[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'invalid_input', 'Control sequences are forbidden');
      mapOutsideWebUris(value, text => mapPrivatePaths(text, () => { throw new ScreeningRefusal('invalid_input', 'Private paths are forbidden'); }));
      insist(!/(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(value), 'invalid_input', 'Email addresses are forbidden');
      insist(scanMutationSecrets(value).length === 0, 'invalid_input', 'SDK privacy guard detected credential-shaped content');
      validated.add(value);
    } else if (value !== null && typeof value === 'object') {
      const prototype = Object.getPrototypeOf(value);
      insist(Array.isArray(value) || prototype === Object.prototype || prototype === null, 'invalid_input', 'Only plain JSON data is supported');
      // JSON arrays never have holes. A hole lets schema validation walk empty slots and read values inherited from
      // Array.prototype that this guard never scans, so only arrays whose keys are exactly 0..length-1 are accepted. The
      // length is checked against the aggregate node budget first, so a huge array never allocates its key list.
      if (Array.isArray(value)) {
        insist(nodes + value.length <= 262144, 'invalid_input', 'Aggregate node scanning budget exceeded');
        const keys = Object.keys(value);
        insist(keys.length === value.length && keys.every((key, index) => key === String(index)), 'invalid_input', 'Sparse arrays are not plain JSON data');
      }
      insist(!seen.has(value), 'invalid_input', 'Cyclic input is forbidden'); seen.add(value);
      for (const name of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
        insist(typeof name === 'string' && 'value' in descriptor && (descriptor.enumerable || (Array.isArray(value) && name === 'length')), 'invalid_input', 'Only enumerable JSON data properties are supported');
      }
      for (const [name, child] of Object.entries(value)) {
        insist(!['__proto__', 'prototype', 'constructor'].includes(name), 'invalid_input', 'Prototype keys are forbidden'); visit(child, depth + 1);
      }
      seen.delete(value);
    }
  }
  visit(value, 0);
}
/** Validate strict contracts without reflecting submitted text or field names. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, stored = false): T {
  if (!stored) guardSubmitted(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ScreeningRefusal(stored ? 'invalid_record' : 'invalid_input', 'Strict screening contract failed', 'Inspect the documented schema; use a successor for incompatible records');
  return parsed.data;
}
