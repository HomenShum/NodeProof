export type ProofloopRunnerTaskPlan = {
    id: string;
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    estimatedCostUsd?: number;
    timeoutMs?: number;
};
export type ProofloopRunnerPlan = {
    schema: "proofloop-runner-plan-v1";
    tasks: ProofloopRunnerTaskPlan[];
};
export type ProofloopRunnerTaskStatus = "queued" | "running" | "passed" | "failed" | "blocked_budget";
export type ProofloopRunnerStatus = "queued" | "running" | "passed" | "failed" | "blocked_budget" | "paused";
export type ProofloopRunnerTaskState = {
    id: string;
    status: ProofloopRunnerTaskStatus;
    attempts: number;
    estimatedCostUsd: number;
    startedAt?: string;
    completedAt?: string;
    exitCode?: number | null;
    signal?: string | null;
    error?: string;
};
export type ProofloopRunnerState = {
    schema: "proofloop-runner-state-v1";
    runId: string;
    planPath: string;
    planDigest: string;
    budgetUsd: number;
    spentEstimatedUsd: number;
    status: ProofloopRunnerStatus;
    createdAt: string;
    updatedAt: string;
    taskStates: ProofloopRunnerTaskState[];
};
export type ProofloopRunnerEvent = {
    schema: "proofloop-runner-event-v1";
    runId: string;
    at: string;
    event: string;
    taskId?: string;
    data?: Record<string, unknown>;
};
export type ProofloopRunnerResult = {
    state: ProofloopRunnerState;
    runDir: string;
    ledgerPath: string;
    exitCode: number;
};
export type ProofloopRunnerOptions = {
    root: string;
    subcommand: "run" | "resume" | "status" | "report";
    planPath?: string;
    runId?: string;
    budgetUsd?: number;
    maxTasks?: number;
    lockTtlMs?: number;
    clearStaleLock?: boolean;
    json?: boolean;
    crashAfterStartTaskId?: string;
    log?: (message: string) => void;
    logError?: (message: string) => void;
};
export declare function runProofloopRunner(options: ProofloopRunnerOptions): Promise<ProofloopRunnerResult>;
export declare function readRunnerPlan(planPath: string): ProofloopRunnerPlan;
export declare function runnerRunDir(root: string, runId: string): string;
export declare function runnerStatePath(runDir: string): string;
export declare function runnerLedgerPath(runDir: string): string;
export declare function formatRunnerStatus(state: ProofloopRunnerState, runDir: string): string;
