export declare const LONG_RUN_RELATIVE_DIR = ".proofloop/longrun";
export declare const LONG_RUN_PLAN_VERSION = 1;
export declare const LONG_RUN_DEFAULT_BUDGET_USD = 100;
export declare const LONG_RUN_DEFAULT_MAX_RETRIES = 2;
export declare const LONG_RUN_DEFAULT_CONCURRENCY = 1;
export declare const LONG_RUN_MAX_CONCURRENCY = 16;
export declare const LONG_RUN_HEARTBEAT_MS = 30000;
export declare const LONG_RUN_STALE_LOCK_MS: number;
/** Redacted stdout/stderr tail stored per attempt_end (chars). */
export declare const LONG_RUN_SNIPPET_MAX_CHARS = 2000;
/** Rolling capture cap per stream while the child runs (chars). BOUND_READ. */
export declare const LONG_RUN_STREAM_CAPTURE_MAX_CHARS: number;
/**
 * Exit codes for `run start`/`run resume`:
 *   0   run complete, every attempt passed
 *   1   run complete, some attempts failed with retries exhausted
 *   2   unusable/refused (bad plan, corrupt ledger, lock conflict, no run)
 *   3   budget_exhausted (distinct so schedulers can tell "stopped at the
 *       budget line" from "the work failed")
 *   130 interrupted by SIGINT/SIGTERM (ledger has run_interrupted)
 */
export declare const LONG_RUN_EXIT: {
    readonly allPassed: 0;
    readonly failures: 1;
    readonly unusable: 2;
    readonly budgetExhausted: 3;
    readonly interrupted: 130;
};
/** Plan file is unusable (missing, unparseable, invalid). CLI exit 2. */
export declare class LongRunPlanError extends Error {
}
/** Ledger is unusable (missing / corrupt non-final line). CLI exit 2. */
export declare class LongRunLedgerError extends Error {
}
export type LongRunAttemptSpec = {
    id: string;
    family: string;
    taskId: string;
    model: string;
    /** argv array (spawned with shell:false -- never a shell string). */
    command: string[];
    timeoutMs: number;
    estCostUsd: number;
    note?: string;
};
export type LongRunPlan = {
    version: 1;
    budgetUsd: number;
    maxRetries: number;
    concurrency: number;
    attempts: LongRunAttemptSpec[];
};
export declare function parseLongRunPlan(value: unknown): LongRunPlan;
export type LongRunVerdict = "pass" | "fail" | "error" | "timeout";
export type LongRunLedgerRecord = {
    type: "run_created";
    schema: "proofloop-longrun-ledger-v1";
    ts: string;
    runId: string;
    attemptTargets: number;
    budgetUsd: number;
    maxRetries: number;
    concurrency: number;
} | {
    type: "run_started";
    ts: string;
    pid: number;
    host: string;
    mode: "start" | "resume";
} | {
    type: "attempt_start";
    ts: string;
    attemptId: string;
    try: number;
} | {
    type: "attempt_end";
    ts: string;
    attemptId: string;
    try: number;
    verdict: LongRunVerdict;
    exitCode: number | null;
    durationMs: number;
    costUsd: number;
    costSource: "actual" | "estimate";
    receiptPath: string | null;
    stdoutTail: string;
    stderrTail: string;
} | {
    type: "budget_exhausted";
    ts: string;
    spentUsd: number;
    budgetUsd: number;
    nextAttemptId: string;
    nextTryEstCostUsd: number;
} | {
    type: "run_interrupted";
    ts: string;
    signal: string;
    inFlightAttemptIds: string[];
} | {
    type: "run_completed";
    ts: string;
    passed: number;
    failed: number;
    spentUsd: number;
    allPassed: boolean;
};
/**
 * Append ONE record as one JSON line, fsync'd. JSON.stringify escapes any
 * embedded newline inside values, so a record can never forge a second line;
 * the fsync means a machine reboot can lose at most the in-flight line.
 */
export declare function appendLongRunLedger(ledgerPath: string, record: LongRunLedgerRecord): void;
export type LongRunLedgerReadResult = {
    records: LongRunLedgerRecord[];
    /** True when an unparseable FINAL line (torn by a crash) was dropped. */
    droppedTornTail: boolean;
    /**
     * Byte length of the file's good prefix (everything up to and including the
     * last parseable line). Only meaningful when droppedTornTail is true; the
     * EXECUTOR truncates the file to this length -- after acquiring the lock --
     * before appending, because appending onto a torn fragment would weld two
     * records into one line and turn a recoverable torn tail into permanent
     * mid-file corruption. Readers (status/report) never mutate the file.
     */
    repairByteLength: number;
};
/**
 * Read the ledger fail-closed: a torn FINAL line is a crash artifact and is
 * dropped (the attempt it belonged to simply re-runs); an unparseable
 * NON-final line is corruption and throws LongRunLedgerError (exit 2) --
 * guessing around mid-file corruption could silently skip or re-bill work.
 */
export declare function readLongRunLedger(ledgerPath: string): LongRunLedgerReadResult;
export type LongRunAttemptProgress = {
    spec: LongRunAttemptSpec;
    /** attempt_end records for this attempt, in ledger order. */
    ends: Extract<LongRunLedgerRecord, {
        type: "attempt_end";
    }>[];
    /** attempt_start records without a matching attempt_end (crash artifacts). */
    orphanStarts: number;
    passed: boolean;
    /** passed, or failed with retries exhausted. Terminal attempts never re-run. */
    terminal: boolean;
    /** 1-based try number the NEXT execution should record. */
    nextTry: number;
};
export type LongRunProgress = {
    attempts: LongRunAttemptProgress[];
    spentUsd: number;
    measuredCostUsd: number;
    estimateFallbackCostUsd: number;
    passed: number;
    failedTerminal: number;
    remaining: number;
    budgetExhaustedSeen: boolean;
    interruptedSeen: boolean;
    durationsMs: number[];
};
export declare function deriveLongRunProgress(plan: LongRunPlan, records: LongRunLedgerRecord[]): LongRunProgress;
/**
 * Redact secret material from captured child output before it is stored:
 *   1. sk-/rk-/pk- style tokens (OPENROUTER/OpenAI key shapes).
 *   2. `NAME=value` / `name: value` where NAME matches the hooks redaction
 *      key pattern (/key|token|secret|password|authorization|bearer|credential/i).
 *   3. The verbatim VALUE of any environment variable whose NAME matches that
 *      pattern (so an echoed $OPENROUTER_API_KEY is caught even if its shape
 *      is unusual). Values shorter than 8 chars are skipped to avoid
 *      redacting the whole snippet on trivial collisions.
 */
export declare function redactLongRunText(text: string, env?: NodeJS.ProcessEnv): string;
export type LongRunPaths = {
    runId: string;
    runDir: string;
    planPath: string;
    ledgerPath: string;
    statePath: string;
    lockPath: string;
    receiptsDir: string;
    costsDir: string;
};
export declare function longRunBaseDir(root: string): string;
/** Resolve --run <id> or the `latest` pointer. Undefined = no run found. */
export declare function resolveLongRunPaths(root: string, runId?: string): LongRunPaths | undefined;
export type LongRunLock = {
    schema: "proofloop-longrun-lock-v1";
    pid: number;
    host: string;
    startedAt: string;
    heartbeatAt: string;
};
export declare function readLongRunLock(lockPath: string): LongRunLock | undefined;
export type LongRunLockState = {
    state: "none";
} | {
    state: "live";
    lock: LongRunLock;
} | {
    state: "stale";
    lock: LongRunLock | undefined;
    reason: string;
};
/**
 * Live = pid alive AND heartbeat fresh (<= 5 min). Stale = pid dead OR
 * heartbeat older than 5 min OR unparseable lock file. When the lock was
 * written on a DIFFERENT host we cannot probe the pid, so liveness rests on
 * the heartbeat alone (documented limitation).
 */
export declare function longRunLockState(lockPath: string, now?: Date): LongRunLockState;
export type LongRunIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
export declare function runLongRunInit(options: {
    root: string;
    planPath?: string;
    runId?: string;
} & LongRunIo): number;
export declare function executeLongRun(options: {
    root: string;
    mode: "start" | "resume";
    runId?: string;
    clearStaleLock?: boolean;
} & LongRunIo): Promise<number>;
export declare function runLongRunStatus(options: {
    root: string;
    runId?: string;
    clearStaleLock?: boolean;
} & LongRunIo): number;
export declare const LONG_RUN_REPORT_FRAMING = "Proxy product proof, NOT an official benchmark score. This report records command executions and receipts captured by the proofloop long-run runner; a pass means the attempt command exited 0. No model winner is claimed, and official scores require the official scorer (or an explicitly recorded equivalent judge contract).";
export type LongRunFamilyReportRow = {
    id: string;
    attempts: number;
    passed: number;
    failed: number;
    remaining: number;
    passRate: number | null;
    spentUsd: number;
    costPerPassUsd: number | null;
};
export type LongRunModelReportRow = {
    modelId: string;
    attempts: number;
    passed: number;
    failed: number;
    remaining: number;
    passRate: number | null;
    spentUsd: number;
    measuredCostUsd: number;
    avgDurationMs: number | null;
    costPerPassUsd: number | null;
};
export type LongRunReport = {
    schema: "proofloop-longrun-report-v1";
    framing: string;
    runId: string;
    generatedAt: string;
    summary: {
        attemptTargets: number;
        passed: number;
        failed: number;
        remaining: number;
        complete: boolean;
        allPassed: boolean;
        triesRecorded: number;
        spentUsd: number;
        budgetUsd: number;
        measuredCostUsd: number;
        estimateFallbackCostUsd: number;
        budgetExhausted: boolean;
        interrupted: boolean;
    };
    families: LongRunFamilyReportRow[];
    modelSummaries: LongRunModelReportRow[];
};
export declare function buildLongRunReport(runId: string, plan: LongRunPlan, records: LongRunLedgerRecord[], now?: Date): LongRunReport;
export declare function formatLongRunReportMarkdown(report: LongRunReport): string;
export declare function runLongRunReport(options: {
    root: string;
    runId?: string;
    json?: boolean;
} & LongRunIo): number;
