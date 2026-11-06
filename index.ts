import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Native screening extension contributes commands, schema and inert renderers. */
const extension = defineExtension({ name: 'pm-screen', version: '2026.11.6', description: 'Durable evidence selection and exact attrition', activate: register });
/** Load through the native pm extension host. */
export default extension;
/** Authorized lifecycle operations shared by agents and CLI. */
export { createScreening, assessCandidate, resolveScreening, nextScreening, screeningReport, checkScreening, screeningPacket, readScreening } from './src/api.ts';
/** Directory adapter and portable authorized host contract. */
export { createDirectoryHost } from './src/host.ts';
/** Injected backend and immutable selected-owner snapshot. */
export type { Host, Snapshot } from './src/host.ts';
/** Pure deterministic eligibility, exact attrition and state validation. */
export { deriveEligibility, deriveScreeningReport, readState } from './src/kernel.ts';
/** Strict public nested schemas and canonical request identity. */
export { KeySchema, DigestSchema, SourceRefSchema, CriterionSchema, ProtocolSchema, EntrySchema, AliasSchema, PopulationSchema, CriterionValueSchema, VectorSchema, DefinitionSchema, AssessmentSchema, AdjudicationSchema, CommittedResultSchema, ReplaySchema, ScreeningStateSchema, CreateScreeningInputSchema, AssessCandidateInputSchema, ResolveInputSchema, ReportInputSchema, CheckInputSchema, NextScreeningInputSchema, PacketInputSchema, canonical, digest } from './src/schema.ts';
/** Public normalized state and submitted request types. */
export type { SourceRef, Definition, Protocol, Vector, ScreeningState, CreateScreeningInput, AssessCandidateInput, ResolveInput, ReportInput, CheckInput, NextScreeningInput, PacketInput } from './src/schema.ts';
/** Strict output contracts and host-owned whole-envelope fitting. */
export { DecisionSchema, ScreeningReportSchema, MutationReceiptSchema, ScreeningDataSchema, ScreeningEnvelopeSchema, envelope, fitEnvelope, refusalEnvelope } from './src/output.ts';
/** Portable output types, including the historical committed result. */
export type { ScreeningData, ScreeningEnvelope, MutationReceipt, OutputOptions } from './src/output.ts';
/** Typed refusals with remedies and stable process exit categories. */
export { ScreeningRefusal, exitCode } from './src/errors.ts';
