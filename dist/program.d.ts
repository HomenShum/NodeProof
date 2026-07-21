import { type NodekitProofMinimumLevel } from "./nodekitProof";
/**
 * P0 program supervisor.
 *
 * This is deliberately an orchestration layer over the existing durable runner:
 * each arc points at one immutable runner plan. It does not accept arbitrary
 * commands itself and it does not add a parallel task-execution engine.
 */
export declare const PROOFLOOP_PROGRAM_PLAN_SCHEMA: "proofloop-program-plan-v1";
export declare const PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA: "proofloop-program-authority-v1";
export declare const PROOFLOOP_PROGRAM_STATE_SCHEMA: "proofloop-program-state-v1";
export declare const PROOFLOOP_PROGRAM_EVENT_SCHEMA: "proofloop-program-event-v1";
export type ProofloopProgramArcMode = "read_only" | "proposal_only";
export type ProofloopProgramArcStatus = "queued" | "running" | "passed" | "failed" | "blocked_budget" | "blocked_authority";
export type ProofloopProgramStatus = "queued" | "running" | "paused" | "certified" | "failed" | "failed_integrity" | "blocked_budget" | "blocked_authority";
export type ProofloopEnvelopeReceiptHook = {
    kind: "proofloop-envelope";
    file: string;
};
export type ProofloopNodeagentIngestionReceiptHook = {
    kind: "nodeagent-ingestion";
    file: string;
    minDocuments?: number;
    minMemoryObjects?: number;
};
/**
 * Binds NodeKit's generated proof receipt to the current compiled application
 * identity and an exact Git candidate before a local-only program arc passes.
 */
export type ProofloopNodekitProofReceiptHook = {
    kind: "nodekit-proof";
    file: string;
    candidateCommit: string;
    minimumLevel?: NodekitProofMinimumLevel;
    compiledDefinition?: string;
    configHashFile?: string;
    discovery?: string;
};
export type ProofloopProgramReceiptHook = ProofloopEnvelopeReceiptHook | ProofloopNodeagentIngestionReceiptHook | ProofloopNodekitProofReceiptHook;
export type ProofloopProgramArcPlan = {
    id: string;
    mode: ProofloopProgramArcMode;
    runnerPlan: string;
    dependsOn?: string[];
    receipt?: ProofloopProgramReceiptHook;
    /** Must remain false in P0. The explicit field makes an attempted egress auditable and blockable. */
    externalEgress?: boolean;
    maxAttempts?: number;
};
export type ProofloopProgramPlan = {
    schema: typeof PROOFLOOP_PROGRAM_PLAN_SCHEMA;
    programId: string;
    authorityPath: string;
    arcs: ProofloopProgramArcPlan[];
};
export type ProofloopProgramAuthority = {
    schema: typeof PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA;
    authorityId: string;
    allowedArcModes: ProofloopProgramArcMode[];
    /** P0 is deliberately local-only. A true value is rejected rather than treated as consent. */
    allowExternalEgress: false;
    maxBudgetUsd: number;
    maxAttemptsPerArc: number;
};
export type ProofloopProgramReceiptVerification = {
    kind: ProofloopProgramReceiptHook["kind"];
    file: string;
    ok: boolean;
    errors: string[];
};
export type ProofloopProgramArcState = {
    id: string;
    mode: ProofloopProgramArcMode;
    dependsOn: string[];
    runnerPlanPath: string;
    runnerPlanDigest: string;
    runnerRunId: string;
    estimatedCostUsd: number;
    /**
     * Last durable runner-spend observation. This lets an interrupted arc
     * recover without charging the program twice for tasks the runner already
     * recorded before the supervisor was interrupted.
     */
    runnerSpentEstimatedUsd?: number;
    maxAttempts: number;
    attempts: number;
    status: ProofloopProgramArcStatus;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    receipt?: ProofloopProgramReceiptVerification;
};
export type ProofloopProgramState = {
    schema: typeof PROOFLOOP_PROGRAM_STATE_SCHEMA;
    programRunId: string;
    programId: string;
    planPath: string;
    planDigest: string;
    authorityPath: string;
    authorityDigest: string;
    budgetUsd: number;
    spentEstimatedUsd: number;
    status: ProofloopProgramStatus;
    createdAt: string;
    updatedAt: string;
    arcStates: ProofloopProgramArcState[];
};
export type ProofloopProgramEvent = {
    schema: typeof PROOFLOOP_PROGRAM_EVENT_SCHEMA;
    programRunId: string;
    at: string;
    event: string;
    arcId?: string;
    data?: Record<string, unknown>;
};
export type ProofloopProgramResult = {
    state: ProofloopProgramState;
    runDir: string;
    ledgerPath: string;
    exitCode: number;
};
export type ProofloopProgramOptions = {
    root: string;
    subcommand: "run" | "resume" | "status" | "report";
    planPath?: string;
    runId?: string;
    budgetUsd?: number;
    maxArcs?: number;
    lockTtlMs?: number;
    clearStaleLock?: boolean;
    json?: boolean;
    log?: (message: string) => void;
    logError?: (message: string) => void;
};
/** Run or resume a dependency-ordered program. P0 only permits local read/proposal arcs. */
export declare function runProofloopProgram(options: ProofloopProgramOptions): Promise<ProofloopProgramResult>;
export declare function readProofloopProgramPlan(rootInput: string, planPathInput: string): ProofloopProgramPlan;
export declare function readProofloopProgramAuthority(rootInput: string, authorityPathInput: string): ProofloopProgramAuthority;
export declare function programRunDir(rootInput: string, runId: string): string;
export declare function programStatePath(runDir: string): string;
export declare function programLedgerPath(runDir: string): string;
export declare function isProgramTerminal(status: ProofloopProgramStatus): boolean;
export declare function formatProofloopProgramStatus(state: ProofloopProgramState, runDir: string): string;
