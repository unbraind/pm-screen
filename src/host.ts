import { PmClient, normalizeItemId } from '@unbrained/pm-cli/sdk/core';
import { readSettings, readSettingsSection, fitOutputEnvelope } from '@unbrained/pm-cli/sdk';
import type { SourceRef, ScreeningState } from './schema.ts';
import { insist } from './errors.ts';

/** Host-owned capability evidence; method presence alone is insufficient. */
export interface Host {
  /** Already authorized native item lifecycle port; backend selection stays host-owned. */
  client: Pick<PmClient, 'get' | 'create' | 'update' | 'readItemRevision' | 'withExpectedItemRevisions' | 'listAllComplete'>;
  /** Conformance assertion supplied by the embedding host. */
  capabilities: { native_item_cas: boolean; create_if_absent: boolean; complete_reads: boolean; provider: string };
  /** Host-pinned whole-envelope fitter. */
  fitOutputEnvelope?: typeof fitOutputEnvelope;
  /** Read-only package settings; activation and reads never migrate them. */
  settings?: () => Promise<unknown>;
  /** Normalize native identities using the backend-owned prefix policy. */
  normalizeId?: (id: string) => Promise<string>;
  /** Explicit create-time schema provisioning for directory SDK consumers. */
  prepareCreate?: () => Promise<void>;
  /** Recorder attribution supplied by the authorized host, not authentication. */
  author: string;
  /** Optional authorized freshness adapter; receives references only. */
  inspectSource?: (ref: SourceRef) => Promise<'current' | 'changed' | 'missing' | 'inaccessible' | 'unknown'>;
  /** Optional observability/crash boundary; never authoritative state. */
  boundary?: (step: string) => Promise<void>;
}
/** Refuse unsupported providers before attempting any storage access. */
export function capable(host: Host): void {
  insist(host.capabilities.native_item_cas && host.capabilities.create_if_absent && host.capabilities.complete_reads, 'backend_unsupported', 'Host lacks certified native CAS or create-if-absent', 'Select a conforming authorized host; backend ports are tracked upstream in pm-cli issues 1399, 1587 and 1588');
}
/** Bind a directory tracker through the public SDK; no runtime git dependency. */
export function createDirectoryHost(pmRoot: string, author: string): Host {
  const client = new PmClient({ cwd: pmRoot, pmRoot, author, noExtensions: false });
  const port = persistedSchemaPort(client, true);
  return { author, client: port, capabilities: { native_item_cas: true, create_if_absent: true, complete_reads: true, provider: 'directory' }, fitOutputEnvelope,
    /** Normalize owner identities using the backend SDK prefix policy. */
    normalizeId: async id => normalizeItemId(id, (await readSettings(pmRoot)).id_prefix),
    /** Read package-owned policy without changing native tracker settings. */
    settings: async () => (await readSettingsSection(pmRoot, 'screen')).value,
    /** Register missing native schema only for explicit creation; never replace peer definitions. */
    prepareCreate: async () => {
      const fields = await client.schemaListFields(); const existing = fields.fields.find(field => field.key === 'screen_state');
      const registry = await client.schemaList(); const type = [...registry.builtin, ...registry.custom, ...registry.extension].find(entry => entry.name === 'Screening');
      if (existing) insist(existing.type === 'object', 'invalid_record', 'screen_state belongs to an incompatible schema');
      if (type) insist(type.folder === 'screenings', 'invalid_record', 'ScreeningState belongs to an incompatible type registration');
      if (!existing) await client.schemaAddField('screen_state', { type: 'object', description: 'Versioned pm-screen owner state' });
      if (!type) await client.schemaAddType('Screening', { folder: 'screenings', description: 'Frozen evidence screening' });
    },
  };
}
/** Full authorized owner snapshot and native immutable revision. */
export interface Snapshot {
  /** Canonical native identity. */
  id: string;
  /** Current canonical item hash. */
  revision: string;
  /** Strictly validated native custom field. */
  state: ScreeningState;
}

/** Translate the one extension-field assignment for a native persisted project-schema route. */
function nativeOptions<T extends { field?: string[] }>(options: T | undefined): Omit<T, 'field'> & { screenState?: unknown } {
  const { field, ...rest } = options ?? {} as T;
  if (field === undefined) return rest;
  insist(field.length === 1 && field[0].startsWith('screen_state='), 'invalid_input', 'Directory adapter only accepts its owned custom field');
  return { ...rest, screenState: JSON.parse(field[0].slice('screen_state='.length)) as unknown };
}

/** Adapt native project-schema routing while retaining the SDK client revision scope. */
export function persistedSchemaPort(client: PmClient, dynamic = false): Host['client'] {
  /** Select the native option route from actual project schema without provisioning on reads. */
  async function route<T extends { field?: string[] }>(options: T | undefined) {
    const usePersisted = !dynamic || (await client.schemaListFields()).fields.some(field => field.key === 'screen_state');
    return usePersisted ? nativeOptions(options) : options;
  }
  const port: Host['client'] = {
    get: client.get.bind(client), readItemRevision: client.readItemRevision.bind(client), withExpectedItemRevisions: client.withExpectedItemRevisions.bind(client), listAllComplete: client.listAllComplete.bind(client),
    /** Route a project-schema custom field through its declared SDK option. */
    create: async options => client.create(await route(options)),
    /** Preserve native locked update dispatch when using persisted directory schema. */
    update: async (id, options) => client.update(id, await route(options)),
  };
  return port;
}
