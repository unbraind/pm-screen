import { createHash } from 'node:crypto';
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
/** Refuse unsafe data before it can enter immutable native history. */
export function guardSubmitted(value: unknown, seen = new Set<object>(), depth = 0): void {
  insist(depth <= 16, 'invalid_input', 'Input nesting exceeds sixteen levels');
  if (typeof value === 'string') {
    insist(value.length <= 8000 && value.isWellFormed(), 'invalid_input', 'Text is oversized or malformed Unicode');
    insist(!/[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'invalid_input', 'Control sequences are forbidden');
    insist(!/(?:[\\/](?:home|Users)[\\/]|[\\/]root(?:[\\/]|\b)|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');
    insist(scanMutationSecrets(value).length === 0, 'invalid_input', 'SDK privacy guard detected credential-shaped content');
  } else if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    insist(Array.isArray(value) || prototype === Object.prototype || prototype === null, 'invalid_input', 'Only plain JSON data is supported');
    insist(!seen.has(value), 'invalid_input', 'Cyclic input is forbidden'); seen.add(value);
    for (const name of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
      insist(typeof name === 'string' && 'value' in descriptor && (descriptor.enumerable || (Array.isArray(value) && name === 'length')), 'invalid_input', 'Only enumerable JSON data properties are supported');
    }
    for (const [name, child] of Object.entries(value)) {
      insist(!['__proto__', 'prototype', 'constructor'].includes(name), 'invalid_input', 'Prototype keys are forbidden'); guardSubmitted(child, seen, depth + 1);
    }
    seen.delete(value);
  }
}
/** Validate strict contracts without reflecting submitted text or field names. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, stored = false): T {
  if (!stored) guardSubmitted(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ScreeningRefusal(stored ? 'invalid_record' : 'invalid_input', 'Strict screening contract failed', 'Inspect the documented schema; use a successor for incompatible records');
  return parsed.data;
}
