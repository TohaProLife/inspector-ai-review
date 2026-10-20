/** Derived from canonical matrix-steel-durable.schema.json (e1579fc1aa4673fe6b616d4cf86f61096db9b84059e18abb032a1c4c929f9dbd).
 * Browser shape validation only; hashes and original authority are server duties. */
import {z} from 'zod';
import {matrixSteelComparisonSourceKeySchema} from './matrix-steel-review.js';
const sha=z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/u);
export const matrixSteelApplicabilityRunSnapshotEntrySchema=z.object({
 pairKey:sha,decisionId:z.uuid(),sequenceNo:z.string().regex(new RegExp("^(?:[1-9][0-9]{0,17}|[1-8][0-9]{18}|9[0-1][0-9]{17}|92[0-1][0-9]{16}|922[0-2][0-9]{15}|9223[0-2][0-9]{14}|92233[0-6][0-9]{13}|922337[0-1][0-9]{12}|92233720[0-2][0-9]{10}|922337203[0-5][0-9]{9}|9223372036[0-7][0-9]{8}|92233720368[0-4][0-9]{7}|922337203685[0-3][0-9]{6}|9223372036854[0-6][0-9]{5}|92233720368547[0-6][0-9]{4}|922337203685477[0-4][0-9]{3}|9223372036854775[0-7][0-9]{2}|922337203685477580[0-6]|9223372036854775807)(?![\\s\\S])",'u')),
 journalContentHash:sha,projectionContentHash:sha,included:z.boolean(),
}).strict();
export const matrixSteelApplicabilityRunSnapshotSchema=z.object({
 schemaVersion:z.literal('matrix-steel-applicability-run-snapshot-v1'),objectId:matrixSteelComparisonSourceKeySchema,
 inputManifestHash:sha,entries:z.array(matrixSteelApplicabilityRunSnapshotEntrySchema).max(16),contentHash:sha,
}).strict();
export type SteelApplicabilityRunSnapshotEntry=z.infer<typeof matrixSteelApplicabilityRunSnapshotEntrySchema>;
export type SteelApplicabilityRunSnapshot=z.infer<typeof matrixSteelApplicabilityRunSnapshotSchema>;
