import { z } from 'zod';
/** Stable keys normalize surrounding whitespace before replay and lookup. */
export const KeySchema = z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
/** Lowercase SHA-256 identities pin exact submitted snapshots. */
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Bounded data text measured in Unicode code points. */
export function textSchema(max: number) { return z.string().trim().min(1).refine(value => [...value].length <= max); }
/** Native snapshot or explicitly supplied public artifact; no source is fetched. */
export const SourceRefSchema = z.union([
  z.strictObject({ item_id: KeySchema, item_hash: DigestSchema, field_pointer: z.string().max(256).regex(/^(?:\/(?:[^~]|~[01])*)?$/), content_digest: DigestSchema, citation_id: KeySchema.optional() }),
  z.strictObject({ public_uri: z.url().startsWith('https://').max(512).refine(value => { const url = new URL(value); return url.username === '' && url.password === ''; }), content_digest: DigestSchema }),
]);
/** Explicit eligibility requirement and evidence obligation. */
export const CriterionSchema = z.strictObject({ criterion_id: KeySchema, kind: z.enum(['inclusion', 'exclusion']), text: textSchema(400), required_evidence: z.boolean() });
/** Immutable declared protocol; order determines one primary exclusion reason. */
export const ProtocolSchema = z.strictObject({ protocol_key: KeySchema, criteria: z.array(CriterionSchema).min(1).max(12), reviewer_slots: z.array(KeySchema).min(1).max(2), primary_reason_order: z.array(KeySchema).min(1).max(12) });
/** One imported entry; canonical identity is explicit rather than inferred. */
export const EntrySchema = z.strictObject({ entry_id: KeySchema, canonical_candidate_id: KeySchema, source_ref: SourceRefSchema, label: textSchema(160) });
/** Exact duplicate identity requires a recorded reason and evidence. */
export const AliasSchema = z.strictObject({ entry_id: KeySchema, canonical_entry_id: KeySchema, reason: textSchema(400), evidence_refs: z.array(SourceRefSchema).min(1).max(4) });
/** Frozen submitted frame, including a qualified completeness claim. */
export const PopulationSchema = z.strictObject({ scope_description: textSchema(400), acquisition_refs: z.array(SourceRefSchema).min(1).max(16), declared_complete: z.boolean(), entries: z.array(EntrySchema).min(1).max(128), alias_witnesses: z.array(AliasSchema).max(127) });
/** Criterion vector retains unknowns and explicit source bindings. */
export const CriterionValueSchema = z.strictObject({ criterion_id: KeySchema, value: z.enum(['met', 'not_met', 'unknown']), evidence_refs: z.array(SourceRefSchema).max(4), reason: textSchema(400) });
/** Every assessment supplies exactly one value for each declared criterion. */
export const VectorSchema = z.array(CriterionValueSchema).min(1).max(12);
/** Immutable owner definition; a revision is a new owner with a predecessor. */
export const DefinitionSchema = z.strictObject({ question: textSchema(400), protocol: ProtocolSchema, population: PopulationSchema, predecessor: z.strictObject({ item_id: KeySchema, item_hash: DigestSchema }).optional() });
/** Attributed assessment; native history retains superseded versions. */
export const AssessmentSchema = z.strictObject({ candidate: KeySchema, reviewer: KeySchema, protocol_digest: DigestSchema, source_digest: DigestSchema, vector: VectorSchema, recorder: KeySchema, recorded_at: z.iso.datetime(), assessment_digest: DigestSchema, previous_digest: DigestSchema.optional(), amendment_reason: textSchema(400).optional() });
/** Explicit adjudication pins the complete set of assessed slots. */
export const AdjudicationSchema = z.strictObject({ candidate: KeySchema, assessment_digests: z.array(DigestSchema).min(1).max(2), vector: VectorSchema, rationale: textSchema(400), recorder: KeySchema, recorded_at: z.iso.datetime() });
/** Original committed result identity remains distinct from current item revision. */
export const CommittedResultSchema = z.strictObject({ kind: z.enum(['create', 'assess', 'resolve']), identity: KeySchema, sequence: z.number().int().min(1).max(512), digest: DigestSchema });
/** Replay identities are never evicted or silently overwritten. */
export const ReplaySchema = z.strictObject({ operation_id: KeySchema, request_digest: DigestSchema, result: CommittedResultSchema, result_digest: DigestSchema });
/** Authoritative native owner field, strictly versioned and bounded. */
export const ScreeningStateSchema = z.strictObject({ version: z.literal(1), package: z.literal('pm-screen'), definition: DefinitionSchema, protocol_digest: DigestSchema, population_digest: DigestSchema, source_manifest_digest: DigestSchema, assessments: z.array(AssessmentSchema).max(256), adjudications: z.array(AdjudicationSchema).max(128), operation_receipts: z.array(ReplaySchema).min(1).max(512) });
const mutation = { id: KeySchema, op: KeySchema, revision: DigestSchema };
/** Freeze the definition under an explicit native ID. */
export const CreateScreeningInputSchema = DefinitionSchema.extend({ id: KeySchema, op: KeySchema });
/** Record or explicitly amend a single reviewer slot. */
export const AssessCandidateInputSchema = z.strictObject({ ...mutation, candidate: KeySchema, reviewer: KeySchema, protocol_digest: DigestSchema, source_digest: DigestSchema, vector: VectorSchema, previous_digest: DigestSchema.optional(), amendment_reason: textSchema(400).optional() });
/** Resolve a disagreement without deleting the opposed assessments. */
export const ResolveInputSchema = z.strictObject({ ...mutation, candidate: KeySchema, assessment_digests: z.array(DigestSchema).min(1).max(2), vector: VectorSchema, rationale: textSchema(400) });
/** Selected-owner report query. */
export const ReportInputSchema = z.strictObject({ id: KeySchema });
/** Explicit authorized freshness inspection query. */
export const CheckInputSchema = ReportInputSchema;
/** A next request is deterministic ordering, never an allocation claim. */
export const NextScreeningInputSchema = ReportInputSchema.extend({ reviewer: KeySchema });
/** Bounded package continuation binds owner, query, revision and stable ordering. */
export const PacketInputSchema = ReportInputSchema.extend({ candidate: KeySchema.optional(), limit: z.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(2048).optional() });
/** Authorized caller supplied reference. */
export type SourceRef = z.infer<typeof SourceRefSchema>;
/** Frozen declaration and submitted frame. */
export type Definition = z.infer<typeof DefinitionSchema>;
/** Frozen declared criterion eligibility protocol. */
export type Protocol = z.infer<typeof ProtocolSchema>;
/** Complete criterion assessment vector. */
export type Vector = z.infer<typeof VectorSchema>;
/** Authoritative version-one state. */
export type ScreeningState = z.infer<typeof ScreeningStateSchema>;
/** Public documented SDK creation request. */
export type CreateScreeningInput = z.input<typeof CreateScreeningInputSchema>;
/** Public documented SDK assessment request. */
export type AssessCandidateInput = z.input<typeof AssessCandidateInputSchema>;
/** Public documented SDK adjudication request. */
export type ResolveInput = z.input<typeof ResolveInputSchema>;
/** Public documented SDK read request. */
export type ReportInput = z.input<typeof ReportInputSchema>;
/** Public documented SDK freshness request. */
export type CheckInput = z.input<typeof CheckInputSchema>;
/** Public documented SDK next-candidate request. */
export type NextScreeningInput = z.input<typeof NextScreeningInputSchema>;
/** Public documented SDK continuation request. */
export type PacketInput = z.input<typeof PacketInputSchema>;
/** Shared canonical identities and strict validation. */
export { canonical, digest, parse } from './privacy.ts';
