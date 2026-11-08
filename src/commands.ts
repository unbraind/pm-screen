import { readSettings, normalizeItemId, selectImportAuthor } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { createScreening, assessCandidate, resolveScreening, nextScreening, screeningReport, checkScreening, screeningPacket } from './api.ts';
import { parse, CreateScreeningInputSchema, AssessCandidateInputSchema, ResolveInputSchema } from './schema.ts';
import { persistedSchemaPort } from './host.ts';
import type { Host } from './host.ts';
import { insist, refusal, ScreeningRefusal } from './errors.ts';
import { envelope, fitEnvelope, refusalEnvelope, renderOutput, outputOptions } from './output.ts';
import type { ScreeningData } from './output.ts';
/** Refuse missing, repeated or empty guard values at the CLI boundary. */
function scalar(value: unknown): string { insist(typeof value === 'string' && value.trim().length > 0, 'invalid_input', 'A required scalar option is missing'); return value; }
/** Parse positive integer controls without rounding or permissive numeric suffixes. */
function integer(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  insist((typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'invalid_input', 'Output control must be a positive integer'); return Number(value);
}
/** Strict bounded UTF-8 input is explicit JSON, never a file or executable instruction. */
export async function inputJson(value: unknown, source: AsyncIterable<Uint8Array> = process.stdin): Promise<Record<string, unknown>> {
  let text = scalar(value);
  if (text === '-') {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of source) { const data = Buffer.from(chunk); bytes += data.length; insist(bytes <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); chunks.push(data); }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new ScreeningRefusal('invalid_input', 'Malformed UTF-8 JSON'); }
  }
  insist(Buffer.byteLength(text) <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch { throw new ScreeningRefusal('invalid_input', 'Malformed JSON'); }
  insist(data !== null && typeof data === 'object' && !Array.isArray(data), 'invalid_input', 'Input must be a strict JSON object'); return data as Record<string, unknown>;
}
/** CLI dispatch uses the public API and shared output-budget preflight before mutations. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    insist(ctx.sdk !== undefined, 'backend_unsupported', 'The host did not supply an SDK client', 'Use pm-cli 2026.11.5 or a conforming authorized host');
    const persisted = (await ctx.sdk.client.schemaListFields()).fields.find(field => field.key === 'screen_state');
    insist(persisted === undefined || persisted.type === 'object', 'invalid_record', 'screen_state has an incompatible schema');
    const sdk = ctx.sdk;
    const host: Host = { author: selectImportAuthor(ctx.global.author, (await readSettings(ctx.pm_root)).author_default), client: persisted ? persistedSchemaPort(sdk.client) : sdk.client, fitOutputEnvelope: sdk.fitOutputEnvelope, settings: async () => (await sdk.readSettingsSection('screen')).value, capabilities: { native_item_cas: true, create_if_absent: true, complete_reads: true, provider: 'directory-host' }, normalizeId: async id => normalizeItemId(id, (await readSettings(ctx.pm_root)).id_prefix) };
    const flags = ctx.options;
    insist(ctx.global.outputInclude === undefined && ctx.global.outputSession === undefined && ctx.global.outputRowContract === undefined, 'invalid_input', 'Generic projection would omit screening witnesses', 'Use --candidate, --limit and --budget');
    insist(flags.budget === undefined || ctx.global.outputBudget === undefined, 'invalid_input', 'Choose one budget transport');
    const requested = flags.budget === undefined ? ctx.global.outputBudget : flags.budget;
    const options = await outputOptions(host, { budget: requested === undefined ? undefined : requested === 'unbounded' ? 8192 : integer(requested, 1600) }); const budget = options.budget!;
    insist(command === 'packet' || (ctx.global.outputCursor === undefined && ctx.global.outputLimit === undefined), 'invalid_input', 'Pagination applies only to screen packet');
    insist(flags.cursor === undefined || ctx.global.outputCursor === undefined, 'invalid_input', 'Choose one continuation transport', 'Use package --cursor');
    insist(flags.limit === undefined || ctx.global.outputLimit === undefined, 'invalid_input', 'Choose one limit transport', 'Use --limit or --output-limit');
    const id = await host.normalizeId!(command === 'create' ? scalar(flags.id) : scalar(ctx.args[0])); let data: ScreeningData;
    if (['create', 'assess', 'resolve'].includes(command)) {
      const raw = await inputJson(flags.input); insist(!Object.keys(raw).some(key => ['id', 'op', 'revision'].includes(key)), 'invalid_input', 'Use explicit identity and revision flags');
      const op = scalar(flags.op);
      if (command === 'create') data = await createScreening(host, parse(CreateScreeningInputSchema, { ...raw, id, op }), options);
      else {
        const revision = scalar(flags.revision);
        if (command === 'assess') data = await assessCandidate(host, parse(AssessCandidateInputSchema, { ...raw, id, op, revision }), options);
        else { insist(raw.candidate === undefined, 'invalid_input', 'Use --candidate for the resolution target'); data = await resolveScreening(host, parse(ResolveInputSchema, { ...raw, id, op, revision, candidate: scalar(flags.candidate) }), options); }
      }
    } else if (command === 'next') data = await nextScreening(host, { id, reviewer: scalar(flags.reviewer) }, options);
    else if (command === 'report') data = await screeningReport(host, { id }, options);
    else if (command === 'check') data = await checkScreening(host, { id }, options);
    else { insist(command === 'packet', 'invalid_input', 'Unknown screen command'); data = await screeningPacket(host, { id, candidate: flags.candidate === undefined ? undefined : scalar(flags.candidate), limit: integer(ctx.global.outputLimit ?? flags.limit, 20), cursor: flags.cursor === undefined ? ctx.global.outputCursor : scalar(flags.cursor) }, options); }
    return fitEnvelope(host, envelope(data), budget);
  } catch (error) { return fitEnvelope({ fitOutputEnvelope: ctx.sdk?.fitOutputEnvelope }, refusalEnvelope(refusal(error)), 1600); }
}
/** Activate native schema and scoped renderers without writing tracker data. */
export function register(api: ExtensionApi): void {
  api.registerItemTypes([{ name: 'Screening', folder: 'screenings', description: 'Frozen population and evidence eligibility judgments' }]);
  api.registerItemFields([{ name: 'screen_state', type: 'object', optional: true }]);
  const definitions = [
    ['create', [], ['id', 'input', 'op'], 'Freeze a declared protocol and candidate population', 'pm screen create --id review --op birth --input -'],
    ['next', ['id'], ['reviewer'], 'Read the canonical next missing or uncertain assessment', 'pm screen next review --reviewer first'],
    ['assess', ['id'], ['input', 'op', 'revision'], 'Record or explicitly amend a criterion vector', 'pm screen assess review --op judgment --revision <hash> --input -'],
    ['resolve', ['id'], ['candidate', 'input', 'op', 'revision'], 'Record an explicit resolution pinned to both assessments', 'pm screen resolve review --candidate source --op resolve --revision <hash> --input -'],
    ['report', ['id'], [], 'Read exact attrition and all unresolved identities', 'pm screen report review'],
    ['check', ['id'], [], 'Check frozen identity; freshness is unknown without an authorized adapter', 'pm screen check review'],
    ['packet', ['id'], ['candidate', 'limit', 'cursor'], 'Resume with bounded complete candidate witnesses', 'pm screen packet review --limit 2 --budget 1600'],
  ] as const;
  for (const format of ['json', 'toon'] as const) api.registerRenderer(format, ctx => renderOutput(ctx.result, format).trimEnd(), { commands: definitions.map(([name]) => `screen ${name}`) });
  for (const [name, args, names, description, example] of definitions) {
    const flags: FlagDefinition[] = [...names, 'budget'].map(flag => ({ long: `--${flag}`, value_type: 'string', value_name: flag, description: `${flag}; ${example}` }));
    api.registerCommand(defineCommand({ ...(['next', 'report', 'check', 'packet'].includes(name) ? { read_output: { row_keys: [] } } : {}), name: `screen ${name}`, description, intent: 'Preserve selection context, unknowns and exact population accounting', arguments: args.map(arg => ({ name: arg, required: true, description: 'Authorized screening owner' })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
