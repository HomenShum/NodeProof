export declare const TRANSFER_SAMPLE_SCHEMA = "proofloop-transfer-sample-v1";
export type TransferLaneResult = {
    taskId: string;
    model: string;
    family: string;
    pass: boolean;
};
export type TransferLaneRead = {
    results: TransferLaneResult[];
    warnings: string[];
    source: "receipts" | "runner-ledger";
};
export type TransferSamplePair = {
    taskId: string;
    model: string;
    family: string;
    capabilityPass: boolean;
};
export type TransferSamplePlan = {
    schema: typeof TRANSFER_SAMPLE_SCHEMA;
    seed: string;
    pairs: TransferSamplePair[];
};
export type TransferDisagreementDirection = "capability-pass-browser-fail" | "capability-fail-browser-pass";
export declare const TRANSFER_DIRECTION_LABELS: Record<TransferDisagreementDirection, string>;
export type TransferDisagreement = {
    taskId: string;
    model: string;
    family: string;
    capabilityPass: boolean;
    browserPass: boolean;
    direction: TransferDisagreementDirection;
    label: string;
};
export type TransferGateEvaluation = {
    status: "agreed" | "diverged" | "unusable";
    /** Present when status === "unusable". */
    reason?: string;
    overlap: number;
    matches: number;
    agreementRatio: number;
    minAgreement: number;
    minOverlap: number;
    capabilityFailuresTotal: number;
    pairedCapabilityFailures: number;
    disagreements: TransferDisagreement[];
    warnings: string[];
};
export declare function readTransferLaneResults(path: string, options?: {
    ledgerModel?: string;
}): TransferLaneRead;
/**
 * Deterministic stratified sample of supplied capability rows. Same seed + same input = byte-identical plan (the per-family
 * PRNG stream is `fnv1a(seed|family)`, so adding a family never changes
 * another family's picks). If a family has capability failures, at least
 * ceil(perFamily/3) of its sample slots are failures (capped by how many
 * failures exist): failures must transfer too, or the failure path of the
 * harness is never checked against the product.
 */
export declare function buildTransferSample(capability: readonly TransferLaneResult[], options: {
    seed: string;
    perFamily?: number;
}): TransferSamplePlan;
export declare function evaluateTransferGate(capability: readonly TransferLaneResult[], browser: readonly TransferLaneResult[], options?: {
    minAgreement?: number;
    minOverlap?: number;
    allowNoFailureOverlap?: boolean;
}): TransferGateEvaluation;
/**
 * Agreement of supplied rows does not authenticate either lane's provenance
 * or establish that the browser rows were selected by the seeded sampler.
 */
export declare function transferClaimLine(evaluation: TransferGateEvaluation): string;
type TransferCheckIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
/**
 * `proofloop transfer-check sample|gate`. Exit codes:
 *   sample: 0 wrote/printed the plan, 2 unusable input or bad flags.
 *   gate:   0 agreed, 1 diverged, 2 unusable (fail-closed).
 */
export declare function runTransferCheckCommand(sub: string | undefined, options: Record<string, string | boolean>, root: string, io?: TransferCheckIo): number;
export {};
