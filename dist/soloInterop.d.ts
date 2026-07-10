import type { ProofloopRunnerPlan } from "./runner";
export declare const SOLO_INTEROP_SCHEMA: "proofloop-solo-interop-v1";
export declare const SOLO_INTEROP_SCHEMA_VERSION: 1;
export declare const SOLO_INTEROP_SCHEMA_DIGEST = "15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9";
export declare const SOLO_INTEROP_SCHEMA_FILE_SHA256 = "92f6f24a56f6e31e5d521f09b625d8714370ffa68ea094d340710c715fc901f2";
export declare const SOLO_INTEROP_STATE_ROOT = ".proofloop/interop/solo";
declare const STATUS_SCHEMA: "nodeproof-solo-interop-status-v1";
type UnknownRecord = Record<string, unknown>;
export type SoloGoalStatus = "not_started" | "running" | "blocked" | "completed" | "failed";
export type SoloClaimTier = "local_ready" | "team_ready" | "certification_ready";
export type SoloClaimBoundary = "product_path" | "proxy" | "official";
export type NodeProofSoloStatus = "passed" | "blocked" | "failed" | "incomplete" | "rejected";
export interface SoloInteropReceiptReference {
    id: string;
    kind: string;
    path: string;
    sha256: string;
    producer: string;
    createdAt: string;
    visibility: "private" | "team" | "public";
    required: boolean;
    verifier?: string;
}
export interface SoloInteropHandoffTask {
    id: string;
    milestone: "R" | "A" | "L" | "P" | "H";
    command: string;
    cwd?: string;
    estimatedCostUsd: number;
    timeoutMs?: number;
    dependsOn?: string[];
    requiredReceiptIds?: string[];
}
export interface SoloInteropEnvelope {
    schema: typeof SOLO_INTEROP_SCHEMA;
    schemaVersion: typeof SOLO_INTEROP_SCHEMA_VERSION;
    contract: {
        owner: "NodeProof";
        schemaId: typeof SOLO_INTEROP_SCHEMA;
        schemaDigest: string;
    };
    programId: string;
    goal: {
        goalId: string;
        parentGoalId?: string;
        loopId: string;
        text: string;
        currentMilestone: "R" | "A" | "L" | "P" | "H";
        status: SoloGoalStatus;
        resumeCommand?: string;
    };
    repository: {
        repoUrl: string;
        baseCommit: string;
        candidateCommit: string;
        branch: string;
        dirty: boolean;
        worktreeId?: string;
    };
    actor: {
        actorId: string;
        role: "owner" | "contributor" | "reviewer" | "verifier" | "agent";
        agentHost: string;
        sessionId?: string;
    };
    claim: {
        text: string;
        tier: SoloClaimTier;
        boundary: SoloClaimBoundary;
    };
    receipts: SoloInteropReceiptReference[];
    budget: {
        maxUsd: number;
        spentUsd: number;
        maxRuntimeMs?: number;
        maxModelCalls?: number;
    };
    sourceVerdict: {
        authority: "advisory";
        status: "advisory_pass" | "advisory_fail" | "blocked" | "incomplete" | "unknown";
        path?: string;
        sha256?: string;
        reason?: string;
    };
    blockers?: Array<{
        kind: "approval" | "secret" | "install" | "budget" | "missing_receipt" | "verification" | "conflict";
        message: string;
        nextAction: string;
    }>;
    evaluation?: {
        candidateProducedAt?: string;
        evaluatorAccessedAt?: string;
        scorer?: {
            kind: "deterministic" | "official" | "equivalent_judge";
            name: string;
            version: string;
            digest?: string;
        };
    };
    handoff?: {
        mode: "advisory";
        tasks: SoloInteropHandoffTask[];
    };
    timestamps: {
        createdAt: string;
        exportedAt: string;
    };
    extensions?: UnknownRecord;
}
export interface SoloInteropValidationIssue {
    severity: "error" | "warning";
    code: string;
    path: string;
    message: string;
}
export interface SoloInteropEvidenceResult {
    id: string;
    kind: string;
    path: string;
    required: boolean;
    expectedSha256: string;
    actualSha256?: string;
    status: "verified" | "missing" | "tampered" | "invalid";
}
export interface SoloInteropValidation {
    ok: boolean;
    envelope?: SoloInteropEnvelope;
    issues: SoloInteropValidationIssue[];
    evidence: SoloInteropEvidenceResult[];
    orderedTasks: SoloInteropHandoffTask[];
    currentCandidateCommit?: string;
    localCanonicalSchemaDigest?: string;
    localSchemaFileSha256?: string;
}
export interface NodeProofSoloReceipt {
    schema: typeof STATUS_SCHEMA;
    authority: "NodeProof";
    status: NodeProofSoloStatus;
    accepted: boolean;
    envelopeSha256: string;
    contractSchemaDigest: string;
    localCanonicalSchemaDigest?: string;
    localSchemaFileSha256?: string;
    evaluatedAt: string;
    programId?: string;
    goalId?: string;
    candidateCommit?: string;
    currentCandidateCommit?: string;
    claim?: {
        tier: SoloClaimTier;
        boundary: SoloClaimBoundary;
        text: string;
    };
    sourceVerdict?: {
        authority: "advisory";
        status: SoloInteropEnvelope["sourceVerdict"]["status"];
    };
    evidence: SoloInteropEvidenceResult[];
    issues: SoloInteropValidationIssue[];
    blockers: Array<{
        kind: string;
        message: string;
        nextAction: string;
    }>;
    nextActions: string[];
    runnerPlanPath?: string;
    runnerPlanSha256?: string;
}
export interface SoloInteropOperationResult {
    receipt: NodeProofSoloReceipt;
    envelopePath: string;
    receiptPath: string;
    runnerPlanPath?: string;
}
export interface ValidateSoloInteropOptions {
    root: string;
}
export interface IngestSoloInteropOptions extends ValidateSoloInteropOptions {
    filePath: string;
    writeRunnerPlan?: boolean;
    now?: () => Date;
}
export interface RunSoloInteropCliOptions {
    root: string;
    subcommand?: string;
    filePath?: string;
    writeRunnerPlan?: boolean;
    json?: boolean;
    log?: (message: string) => void;
    logError?: (message: string) => void;
}
export declare function soloInteropRoot(root: string): string;
export declare function soloInteropEnvelopePath(root: string): string;
export declare function soloInteropReceiptPath(root: string): string;
export declare function soloInteropRunnerPlanPath(root: string): string;
export declare function validateSoloInteropEnvelope(input: unknown, options: ValidateSoloInteropOptions): SoloInteropValidation;
export declare function compileSoloHandoffRunnerPlan(validation: SoloInteropValidation): ProofloopRunnerPlan;
export declare function ingestSoloInterop(options: IngestSoloInteropOptions): SoloInteropOperationResult;
export declare function refreshSoloInteropStatus(rootInput: string, now?: () => Date): SoloInteropOperationResult | undefined;
export declare function runSoloInteropCli(options: RunSoloInteropCliOptions): number;
export declare function formatNodeProofSoloReceipt(receipt: NodeProofSoloReceipt): string;
export declare function resolveSafeRepoPath(rootInput: string, repoPath: string): string;
export {};
