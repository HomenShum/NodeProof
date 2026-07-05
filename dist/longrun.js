"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LONG_RUN_REPORT_FRAMING = exports.LongRunLedgerError = exports.LongRunPlanError = exports.LONG_RUN_EXIT = exports.LONG_RUN_STREAM_CAPTURE_MAX_CHARS = exports.LONG_RUN_SNIPPET_MAX_CHARS = exports.LONG_RUN_STALE_LOCK_MS = exports.LONG_RUN_HEARTBEAT_MS = exports.LONG_RUN_MAX_CONCURRENCY = exports.LONG_RUN_DEFAULT_CONCURRENCY = exports.LONG_RUN_DEFAULT_MAX_RETRIES = exports.LONG_RUN_DEFAULT_BUDGET_USD = exports.LONG_RUN_PLAN_VERSION = exports.LONG_RUN_RELATIVE_DIR = void 0;
exports.parseLongRunPlan = parseLongRunPlan;
exports.appendLongRunLedger = appendLongRunLedger;
exports.readLongRunLedger = readLongRunLedger;
exports.deriveLongRunProgress = deriveLongRunProgress;
exports.redactLongRunText = redactLongRunText;
exports.longRunBaseDir = longRunBaseDir;
exports.resolveLongRunPaths = resolveLongRunPaths;
exports.readLongRunLock = readLongRunLock;
exports.longRunLockState = longRunLockState;
exports.runLongRunInit = runLongRunInit;
exports.executeLongRun = executeLongRun;
exports.runLongRunStatus = runLongRunStatus;
exports.buildLongRunReport = buildLongRunReport;
exports.formatLongRunReportMarkdown = formatLongRunReportMarkdown;
exports.runLongRunReport = runLongRunReport;
/**
 * `proofloop run <init|start|resume|status|report>` -- the durable long-run
 * benchmark executor.
 *
 * WHY THIS EXISTS: benchmark matrices (e.g. the noderoom prod proxy matrix at
 * /eval/proofloop-prod-proxy-benchmark-matrix.json) declare thousands of
 * model x task attempt targets that take hours or days to execute on a machine
 * where the internet can drop. This module turns a declared RunPlan into an
 * append-only, crash-safe execution ledger with budget enforcement.
 *
 * HONESTY BOUNDARY: the runner EXECUTES commands and RECORDS receipts. It does
 * NOT grade, score, or claim benchmark results -- a "pass" verdict here means
 * "the attempt command exited 0", which is proxy product proof, NOT an
 * official benchmark score. Report output carries that framing explicitly and
 * never claims a model winner.
 *
 * DURABILITY MODEL (JSONL, not sqlite): package engines say node >=20 while
 * node:sqlite needs >=22.5, so the ledger is an append-only JSONL file -- one
 * JSON object per line, fsync'd per append. A crash can only tear the LAST
 * line; readers detect an unparseable final line, drop it, and re-run the
 * attempt whose attempt_end was lost. An unparseable NON-final line is
 * corruption and fails closed (exit 2) instead of guessing.
 *
 * SECRETS: the plan and ledger never store API keys. Child commands read
 * secrets (e.g. OPENROUTER_API_KEY) from the inherited environment. Plan
 * validation REJECTS secret-looking strings fail-closed; captured
 * stdout/stderr tails are redacted (sk-style tokens, key=value pairs with
 * secret-looking names, and any secret-named env value appearing verbatim)
 * BEFORE they touch the ledger.
 *
 * SINGLE-FLIGHT: lock.json (pid + host + heartbeat, refreshed every 30s)
 * guarantees two runners never double-execute a run. A lock is stale when its
 * pid is dead or its heartbeat is older than 5 minutes; stale locks are
 * reported by `run status` and cleared only with an explicit
 * `--clear-stale-lock`.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
// ---------------------------------------------------------------------------
// constants
exports.LONG_RUN_RELATIVE_DIR = ".proofloop/longrun";
exports.LONG_RUN_PLAN_VERSION = 1;
exports.LONG_RUN_DEFAULT_BUDGET_USD = 100;
exports.LONG_RUN_DEFAULT_MAX_RETRIES = 2;
exports.LONG_RUN_DEFAULT_CONCURRENCY = 1;
exports.LONG_RUN_MAX_CONCURRENCY = 16;
exports.LONG_RUN_HEARTBEAT_MS = 30_000;
exports.LONG_RUN_STALE_LOCK_MS = 5 * 60_000;
/** Redacted stdout/stderr tail stored per attempt_end (chars). */
exports.LONG_RUN_SNIPPET_MAX_CHARS = 2_000;
/** Rolling capture cap per stream while the child runs (chars). BOUND_READ. */
exports.LONG_RUN_STREAM_CAPTURE_MAX_CHARS = 64 * 1024;
/**
 * Exit codes for `run start`/`run resume`:
 *   0   run complete, every attempt passed
 *   1   run complete, some attempts failed with retries exhausted
 *   2   unusable/refused (bad plan, corrupt ledger, lock conflict, no run)
 *   3   budget_exhausted (distinct so schedulers can tell "stopped at the
 *       budget line" from "the work failed")
 *   130 interrupted by SIGINT/SIGTERM (ledger has run_interrupted)
 */
exports.LONG_RUN_EXIT = {
    allPassed: 0,
    failures: 1,
    unusable: 2,
    budgetExhausted: 3,
    interrupted: 130,
};
/** Plan file is unusable (missing, unparseable, invalid). CLI exit 2. */
class LongRunPlanError extends Error {
}
exports.LongRunPlanError = LongRunPlanError;
/** Ledger is unusable (missing / corrupt non-final line). CLI exit 2. */
class LongRunLedgerError extends Error {
}
exports.LongRunLedgerError = LongRunLedgerError;
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Prototype-pollution-inert own-key read (same doctrine as the tooluse loader). */
function ownGet(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
function rejectUnknownKeys(record, allowed, context) {
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) {
            throw new LongRunPlanError(`${context}: unknown key "${key}" (allowed: ${allowed.join(", ")}). Refusing to guess -- a typo here would silently change what gets executed or spent.`);
        }
    }
}
/** Secret-looking token (sk-/rk-/pk- style). Plans must NEVER embed keys. */
const SECRET_TOKEN_RE = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/;
/** Same key-name pattern the generated hooks logger redacts on. */
const REDACT_KEY_RE = /key|token|secret|password|authorization|bearer|credential/i;
/** `SOME_API_KEY=value` / `token: value` shapes inside free text. */
const SECRET_ASSIGNMENT_RE = /([A-Za-z0-9_.-]*(?:key|token|secret|password|authorization|bearer|credential)[A-Za-z0-9_.-]*\s*[=:]\s*)(\S{6,})/gi;
function assertNoEmbeddedSecret(value, context) {
    if (SECRET_TOKEN_RE.test(value)) {
        throw new LongRunPlanError(`${context}: contains a secret-looking token. Secrets (e.g. OPENROUTER_API_KEY) must be read from the environment by the child command, never stored in the plan.`);
    }
}
function requireString(value, context) {
    if (typeof value !== "string" || value.length === 0) {
        throw new LongRunPlanError(`${context}: must be a non-empty string.`);
    }
    return value;
}
function requirePositiveInt(value, context) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new LongRunPlanError(`${context}: must be a positive integer.`);
    }
    return value;
}
function requireNonNegativeNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new LongRunPlanError(`${context}: must be a finite number >= 0.`);
    }
    return value;
}
function parseLongRunPlan(value) {
    if (!isPlainObject(value))
        throw new LongRunPlanError("plan must be a JSON object.");
    rejectUnknownKeys(value, ["version", "budgetUsd", "maxRetries", "concurrency", "attempts", "$comment", "description"], "plan");
    const versionRaw = ownGet(value, "version");
    if (versionRaw !== undefined && versionRaw !== exports.LONG_RUN_PLAN_VERSION) {
        throw new LongRunPlanError(`plan.version must be exactly ${exports.LONG_RUN_PLAN_VERSION} when present (got ${JSON.stringify(versionRaw)}).`);
    }
    const budgetRaw = ownGet(value, "budgetUsd");
    const budgetUsd = budgetRaw === undefined ? exports.LONG_RUN_DEFAULT_BUDGET_USD : requireNonNegativeNumber(budgetRaw, "plan.budgetUsd");
    if (budgetUsd <= 0)
        throw new LongRunPlanError("plan.budgetUsd: must be > 0 (a zero budget can never execute anything).");
    const retriesRaw = ownGet(value, "maxRetries");
    const maxRetries = retriesRaw === undefined
        ? exports.LONG_RUN_DEFAULT_MAX_RETRIES
        : (() => {
            if (typeof retriesRaw !== "number" || !Number.isInteger(retriesRaw) || retriesRaw < 0) {
                throw new LongRunPlanError("plan.maxRetries: must be an integer >= 0.");
            }
            return retriesRaw;
        })();
    const concurrencyRaw = ownGet(value, "concurrency");
    const concurrency = concurrencyRaw === undefined ? exports.LONG_RUN_DEFAULT_CONCURRENCY : requirePositiveInt(concurrencyRaw, "plan.concurrency");
    if (concurrency > exports.LONG_RUN_MAX_CONCURRENCY) {
        throw new LongRunPlanError(`plan.concurrency: must be <= ${exports.LONG_RUN_MAX_CONCURRENCY} (BOUND: a runaway pool is how machines melt mid-benchmark).`);
    }
    const attemptsRaw = ownGet(value, "attempts");
    if (!Array.isArray(attemptsRaw) || attemptsRaw.length === 0) {
        throw new LongRunPlanError("plan.attempts: must be a non-empty array.");
    }
    const seenIds = new Set();
    const attempts = attemptsRaw.map((entry, i) => {
        const context = `plan.attempts[${i}]`;
        if (!isPlainObject(entry))
            throw new LongRunPlanError(`${context}: must be an object.`);
        rejectUnknownKeys(entry, ["id", "family", "taskId", "model", "command", "timeoutMs", "estCostUsd", "note", "$comment"], context);
        const id = requireString(ownGet(entry, "id"), `${context}.id`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:@\/-]*$/.test(id)) {
            throw new LongRunPlanError(`${context}.id: ${JSON.stringify(id)} must be alphanumeric plus ._:@/- (it becomes a receipt filename).`);
        }
        if (seenIds.has(id))
            throw new LongRunPlanError(`${context}.id: duplicate id ${JSON.stringify(id)} (ids key the resume ledger; duplicates would merge histories).`);
        seenIds.add(id);
        const family = requireString(ownGet(entry, "family"), `${context}.family`);
        const taskId = requireString(ownGet(entry, "taskId"), `${context}.taskId`);
        const model = requireString(ownGet(entry, "model"), `${context}.model`);
        const commandRaw = ownGet(entry, "command");
        if (!Array.isArray(commandRaw) || commandRaw.length === 0) {
            throw new LongRunPlanError(`${context}.command: must be a non-empty argv array (["node", "script.js", ...]), not a shell string.`);
        }
        const command = commandRaw.map((part, j) => {
            const s = requireString(part, `${context}.command[${j}]`);
            assertNoEmbeddedSecret(s, `${context}.command[${j}]`);
            return s;
        });
        const timeoutMs = requirePositiveInt(ownGet(entry, "timeoutMs"), `${context}.timeoutMs`);
        const estCostUsd = requireNonNegativeNumber(ownGet(entry, "estCostUsd"), `${context}.estCostUsd`);
        const noteRaw = ownGet(entry, "note");
        if (noteRaw !== undefined && typeof noteRaw !== "string")
            throw new LongRunPlanError(`${context}.note: must be a string.`);
        if (typeof noteRaw === "string")
            assertNoEmbeddedSecret(noteRaw, `${context}.note`);
        return { id, family, taskId, model, command, timeoutMs, estCostUsd, ...(typeof noteRaw === "string" ? { note: noteRaw } : {}) };
    });
    return { version: exports.LONG_RUN_PLAN_VERSION, budgetUsd, maxRetries, concurrency, attempts };
}
const LEDGER_RECORD_TYPES = new Set([
    "run_created",
    "run_started",
    "attempt_start",
    "attempt_end",
    "budget_exhausted",
    "run_interrupted",
    "run_completed",
]);
/**
 * Append ONE record as one JSON line, fsync'd. JSON.stringify escapes any
 * embedded newline inside values, so a record can never forge a second line;
 * the fsync means a machine reboot can lose at most the in-flight line.
 */
function appendLongRunLedger(ledgerPath, record) {
    const fd = (0, node_fs_1.openSync)(ledgerPath, "a");
    try {
        (0, node_fs_1.writeSync)(fd, `${JSON.stringify(record)}\n`, null, "utf8");
        (0, node_fs_1.fsyncSync)(fd);
    }
    finally {
        (0, node_fs_1.closeSync)(fd);
    }
}
/**
 * Read the ledger fail-closed: a torn FINAL line is a crash artifact and is
 * dropped (the attempt it belonged to simply re-runs); an unparseable
 * NON-final line is corruption and throws LongRunLedgerError (exit 2) --
 * guessing around mid-file corruption could silently skip or re-bill work.
 */
function readLongRunLedger(ledgerPath) {
    if (!(0, node_fs_1.existsSync)(ledgerPath)) {
        throw new LongRunLedgerError(`ledger not found at ${ledgerPath} -- not an initialized run (run \`proofloop run init\` first).`);
    }
    const raw = (0, node_fs_1.readFileSync)(ledgerPath, "utf8");
    // Walk lines while tracking each line's char start, so a torn tail can be
    // physically truncated at the exact end of the last good line.
    const lines = [];
    let offset = 0;
    for (const part of raw.split("\n")) {
        if (part.trim().length > 0)
            lines.push({ text: part, start: offset });
        offset += part.length + 1; // the "\n" split on (harmlessly overshoots at EOF)
    }
    const records = [];
    let droppedTornTail = false;
    let repairByteLength = Buffer.byteLength(raw, "utf8");
    for (let i = 0; i < lines.length; i++) {
        let parsed;
        try {
            parsed = JSON.parse(lines[i].text);
        }
        catch {
            parsed = undefined;
        }
        if (!isPlainObject(parsed) || typeof parsed.type !== "string" || !LEDGER_RECORD_TYPES.has(parsed.type)) {
            if (i === lines.length - 1) {
                droppedTornTail = true;
                repairByteLength = Buffer.byteLength(raw.slice(0, lines[i].start), "utf8");
                break;
            }
            throw new LongRunLedgerError(`ledger line ${i + 1} of ${lines.length} is unparseable -- mid-file corruption, refusing to guess (fail-closed).`);
        }
        records.push(parsed);
    }
    return { records, droppedTornTail, repairByteLength };
}
function deriveLongRunProgress(plan, records) {
    const maxTries = plan.maxRetries + 1;
    const startsById = new Map();
    const endsById = new Map();
    let budgetExhaustedSeen = false;
    let interruptedSeen = false;
    for (const record of records) {
        if (record.type === "attempt_start") {
            const list = startsById.get(record.attemptId) ?? [];
            list.push(record);
            startsById.set(record.attemptId, list);
        }
        else if (record.type === "attempt_end") {
            const list = endsById.get(record.attemptId) ?? [];
            list.push(record);
            endsById.set(record.attemptId, list);
        }
        else if (record.type === "budget_exhausted") {
            budgetExhaustedSeen = true;
        }
        else if (record.type === "run_interrupted") {
            interruptedSeen = true;
        }
    }
    let spentUsd = 0;
    let measuredCostUsd = 0;
    let estimateFallbackCostUsd = 0;
    const durationsMs = [];
    const attempts = plan.attempts.map((spec) => {
        const starts = startsById.get(spec.id) ?? [];
        const ends = endsById.get(spec.id) ?? [];
        for (const end of ends) {
            const cost = Number.isFinite(end.costUsd) && end.costUsd >= 0 ? end.costUsd : 0;
            spentUsd += cost;
            if (end.costSource === "actual")
                measuredCostUsd += cost;
            else
                estimateFallbackCostUsd += cost;
            if (Number.isFinite(end.durationMs) && end.durationMs >= 0)
                durationsMs.push(end.durationMs);
        }
        const endedTries = new Set(ends.map((end) => end.try));
        const orphanStarts = starts.filter((start) => !endedTries.has(start.try)).length;
        const passed = ends.some((end) => end.verdict === "pass");
        // Orphaned starts (crash mid-attempt) do NOT count against retries: no
        // verdict was recorded, so no verdict is charged. They DO advance the try
        // counter so re-runs are unambiguous in the ledger.
        const terminal = passed || ends.length >= maxTries;
        const maxSeenTry = Math.max(0, ...starts.map((start) => start.try), ...ends.map((end) => end.try));
        return { spec, ends, orphanStarts, passed, terminal, nextTry: maxSeenTry + 1 };
    });
    const passed = attempts.filter((attempt) => attempt.passed).length;
    const failedTerminal = attempts.filter((attempt) => attempt.terminal && !attempt.passed).length;
    const remaining = attempts.filter((attempt) => !attempt.terminal).length;
    return {
        attempts,
        spentUsd,
        measuredCostUsd,
        estimateFallbackCostUsd,
        passed,
        failedTerminal,
        remaining,
        budgetExhaustedSeen,
        interruptedSeen,
        durationsMs,
    };
}
// ---------------------------------------------------------------------------
// redaction (value-based; complements the key-based hooks logger redaction)
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
function redactLongRunText(text, env = process.env) {
    let out = text.replace(new RegExp(SECRET_TOKEN_RE.source, "g"), "[redacted]");
    out = out.replace(SECRET_ASSIGNMENT_RE, "$1[redacted]");
    for (const [name, value] of Object.entries(env)) {
        if (typeof value === "string" && value.length >= 8 && REDACT_KEY_RE.test(name)) {
            out = out.split(value).join("[redacted]");
        }
    }
    return out;
}
function capTail(text, maxChars) {
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}
function longRunBaseDir(root) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), ...exports.LONG_RUN_RELATIVE_DIR.split("/"));
}
function longRunPaths(root, runId) {
    const runDir = (0, node_path_1.join)(longRunBaseDir(root), runId);
    return {
        runId,
        runDir,
        planPath: (0, node_path_1.join)(runDir, "plan.json"),
        ledgerPath: (0, node_path_1.join)(runDir, "ledger.jsonl"),
        statePath: (0, node_path_1.join)(runDir, "state.json"),
        lockPath: (0, node_path_1.join)(runDir, "lock.json"),
        receiptsDir: (0, node_path_1.join)(runDir, "receipts"),
        costsDir: (0, node_path_1.join)(runDir, "costs"),
    };
}
function latestPointerPath(root) {
    return (0, node_path_1.join)(longRunBaseDir(root), "latest");
}
/** Resolve --run <id> or the `latest` pointer. Undefined = no run found. */
function resolveLongRunPaths(root, runId) {
    let id = runId;
    if (!id) {
        const pointer = latestPointerPath(root);
        if (!(0, node_fs_1.existsSync)(pointer))
            return undefined;
        id = (0, node_fs_1.readFileSync)(pointer, "utf8").trim();
        if (!id)
            return undefined;
    }
    const paths = longRunPaths(root, id);
    if (!(0, node_fs_1.existsSync)(paths.runDir))
        return undefined;
    return paths;
}
function writeLock(lockPath, startedAt) {
    const lock = {
        schema: "proofloop-longrun-lock-v1",
        pid: process.pid,
        host: (0, node_os_1.hostname)(),
        startedAt,
        heartbeatAt: new Date().toISOString(),
    };
    (0, node_fs_1.writeFileSync)(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}
function readLongRunLock(lockPath) {
    if (!(0, node_fs_1.existsSync)(lockPath))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(lockPath, "utf8"));
        if (isPlainObject(parsed) && typeof parsed.pid === "number" && typeof parsed.heartbeatAt === "string") {
            return parsed;
        }
    }
    catch {
        // Unparseable lock = treat as stale-corrupt below.
    }
    return undefined;
}
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
/**
 * Live = pid alive AND heartbeat fresh (<= 5 min). Stale = pid dead OR
 * heartbeat older than 5 min OR unparseable lock file. When the lock was
 * written on a DIFFERENT host we cannot probe the pid, so liveness rests on
 * the heartbeat alone (documented limitation).
 */
function longRunLockState(lockPath, now = new Date()) {
    if (!(0, node_fs_1.existsSync)(lockPath))
        return { state: "none" };
    const lock = readLongRunLock(lockPath);
    if (!lock)
        return { state: "stale", lock: undefined, reason: "lock file is unparseable" };
    const heartbeatAge = now.getTime() - Date.parse(lock.heartbeatAt);
    if (!Number.isFinite(heartbeatAge) || heartbeatAge > exports.LONG_RUN_STALE_LOCK_MS) {
        return { state: "stale", lock, reason: `heartbeat is ${Number.isFinite(heartbeatAge) ? `${Math.round(heartbeatAge / 1000)}s` : "unreadably"} old (> ${exports.LONG_RUN_STALE_LOCK_MS / 60_000} min)` };
    }
    if (lock.host === (0, node_os_1.hostname)() && !pidAlive(lock.pid)) {
        return { state: "stale", lock, reason: `pid ${lock.pid} is dead` };
    }
    return { state: "live", lock };
}
function writeStateSnapshot(paths, status, createdAt) {
    let created = createdAt;
    if (!created && (0, node_fs_1.existsSync)(paths.statePath)) {
        try {
            const prior = JSON.parse((0, node_fs_1.readFileSync)(paths.statePath, "utf8"));
            if (isPlainObject(prior) && typeof prior.createdAt === "string")
                created = prior.createdAt;
        }
        catch {
            // fall through to now()
        }
    }
    const snapshot = {
        schema: "proofloop-longrun-state-v1",
        runId: paths.runId,
        createdAt: created ?? new Date().toISOString(),
        status,
        updatedAt: new Date().toISOString(),
        authoritative: "ledger.jsonl",
        note: "Convenience snapshot only. A crash can leave this stale; status/resume always derive truth from ledger.jsonl.",
    };
    (0, node_fs_1.writeFileSync)(paths.statePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}
function usd(value) {
    return `$${value.toFixed(4)}`;
}
// ---------------------------------------------------------------------------
// `proofloop run init --plan <plan.json> [--id <runId>]`
function runLongRunInit(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const root = (0, node_path_1.resolve)(options.root);
    if (!options.planPath) {
        logError("proofloop run init: --plan <plan.json> is required.");
        return exports.LONG_RUN_EXIT.unusable;
    }
    const planFile = (0, node_path_1.resolve)(root, options.planPath);
    if (!(0, node_fs_1.existsSync)(planFile)) {
        logError(`proofloop run init: plan file not found at ${planFile} (fail-closed).`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    let plan;
    try {
        plan = parseLongRunPlan(JSON.parse((0, node_fs_1.readFileSync)(planFile, "utf8")));
    }
    catch (error) {
        logError(`proofloop run init: ${error instanceof Error ? error.message : String(error)}`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    const runId = options.runId ?? generateRunId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) {
        logError(`proofloop run init: --id ${JSON.stringify(runId)} must be alphanumeric plus ._- (max 64 chars; it becomes a directory name).`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    const paths = longRunPaths(root, runId);
    if ((0, node_fs_1.existsSync)(paths.runDir)) {
        logError(`proofloop run init: run "${runId}" already exists at ${paths.runDir}. Refusing to overwrite an existing ledger (fail-closed); pass a different --id.`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    (0, node_fs_1.mkdirSync)(paths.receiptsDir, { recursive: true });
    (0, node_fs_1.mkdirSync)(paths.costsDir, { recursive: true });
    // Normalized plan copy (defaults made explicit) is the execution contract.
    (0, node_fs_1.writeFileSync)(paths.planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    const now = new Date().toISOString();
    appendLongRunLedger(paths.ledgerPath, {
        type: "run_created",
        schema: "proofloop-longrun-ledger-v1",
        ts: now,
        runId,
        attemptTargets: plan.attempts.length,
        budgetUsd: plan.budgetUsd,
        maxRetries: plan.maxRetries,
        concurrency: plan.concurrency,
    });
    writeStateSnapshot(paths, "created", now);
    (0, node_fs_1.writeFileSync)(latestPointerPath(root), `${runId}\n`, "utf8");
    const totalEst = plan.attempts.reduce((sum, attempt) => sum + attempt.estCostUsd, 0);
    log(`proofloop run init: created run "${runId}"`);
    log(`  dir:      ${paths.runDir}`);
    log(`  attempts: ${plan.attempts.length} (maxRetries ${plan.maxRetries}, concurrency ${plan.concurrency})`);
    log(`  budget:   ${usd(plan.budgetUsd)} (plan first-try estimates total ${usd(totalEst)})`);
    if (totalEst > plan.budgetUsd) {
        log(`  WARNING: plan estimates (${usd(totalEst)}) exceed the budget (${usd(plan.budgetUsd)}). The run will stop honestly at the budget line (exit ${exports.LONG_RUN_EXIT.budgetExhausted}, budget_exhausted in the ledger) -- it will NOT silently skip attempts.`);
    }
    log("  secrets:  child commands read keys (e.g. OPENROUTER_API_KEY) from the environment at spawn time; nothing is stored in plan or ledger.");
    log(`  next:     proofloop run start --run ${runId}`);
    return 0;
}
function generateRunId() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.random().toString(16).slice(2, 6);
    return `run-${stamp}-${rand}`;
}
function spawnAttemptTry(spec, env, cwd, children) {
    return new Promise((resolvePromise) => {
        const started = Date.now();
        let stdoutTail = "";
        let stderrTail = "";
        let timedOut = false;
        let settled = false;
        const settle = (verdict, exitCode) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(killTimer);
            children.delete(child);
            resolvePromise({ verdict, exitCode, durationMs: Date.now() - started, stdoutTail, stderrTail });
        };
        const child = (0, node_child_process_1.spawn)(spec.command[0], spec.command.slice(1), {
            cwd,
            env,
            shell: false, // argv array only -- no shell-string injection surface.
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        children.add(child);
        const killTimer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill("SIGTERM");
            }
            catch {
                /* already gone */
            }
            const hardKill = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                }
                catch {
                    /* already gone */
                }
            }, 5_000);
            hardKill.unref();
        }, spec.timeoutMs);
        child.stdout?.on("data", (chunk) => {
            stdoutTail = capTail(stdoutTail + chunk.toString("utf8"), exports.LONG_RUN_STREAM_CAPTURE_MAX_CHARS);
        });
        child.stderr?.on("data", (chunk) => {
            stderrTail = capTail(stderrTail + chunk.toString("utf8"), exports.LONG_RUN_STREAM_CAPTURE_MAX_CHARS);
        });
        child.on("error", (error) => {
            stderrTail = capTail(`${stderrTail}\n[spawn error] ${error.message}`, exports.LONG_RUN_STREAM_CAPTURE_MAX_CHARS);
            settle("error", null);
        });
        child.on("close", (code) => {
            settle(timedOut ? "timeout" : code === 0 ? "pass" : "fail", code);
        });
    });
}
function readActualCost(costFile) {
    if (!(0, node_fs_1.existsSync)(costFile))
        return undefined;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(costFile, "utf8"));
        if (isPlainObject(parsed) && typeof parsed.actualCostUsd === "number" && Number.isFinite(parsed.actualCostUsd) && parsed.actualCostUsd >= 0) {
            return { costUsd: parsed.actualCostUsd, costSource: "actual" };
        }
    }
    catch {
        // Unparseable cost file falls back to the estimate below (recorded as such).
    }
    return undefined;
}
function executeLongRun(options) {
    return executeLongRunInner(options);
}
async function executeLongRunInner(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const root = (0, node_path_1.resolve)(options.root);
    const label = `proofloop run ${options.mode}`;
    const paths = resolveLongRunPaths(root, options.runId);
    if (!paths) {
        logError(`${label}: no run found${options.runId ? ` with id "${options.runId}"` : " (no .proofloop/longrun/latest pointer)"}. Run \`proofloop run init --plan <plan.json>\` first.`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    let plan;
    try {
        plan = parseLongRunPlan(JSON.parse((0, node_fs_1.readFileSync)(paths.planPath, "utf8")));
    }
    catch (error) {
        logError(`${label}: stored plan is invalid: ${error instanceof Error ? error.message : String(error)} (fail-closed).`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    let ledger;
    try {
        ledger = readLongRunLedger(paths.ledgerPath);
    }
    catch (error) {
        logError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    if (ledger.droppedTornTail) {
        log(`${label}: ledger recovery -- dropped a torn final line (crash artifact). The attempt whose record was lost will re-run.`);
    }
    const progress = deriveLongRunProgress(plan, ledger.records);
    if (options.mode === "start" && ledger.records.some((record) => record.type === "attempt_start")) {
        logError(`${label}: run "${paths.runId}" already has execution history. Use \`proofloop run resume --run ${paths.runId}\` (start refuses so two entry points never disagree about retry counts).`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    if (progress.remaining === 0) {
        log(`${label}: run "${paths.runId}" is already complete -- nothing to execute.`);
        printProgressSummary(log, plan, progress);
        return progress.failedTerminal === 0 ? exports.LONG_RUN_EXIT.allPassed : exports.LONG_RUN_EXIT.failures;
    }
    // ---- single-flight lock ----
    const lockState = longRunLockState(paths.lockPath);
    if (lockState.state === "live") {
        logError(`${label}: refusing -- a live runner holds the lock (pid ${lockState.lock.pid} on ${lockState.lock.host}, heartbeat ${lockState.lock.heartbeatAt}). Two runners would double-execute attempts and double-spend the budget.`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    if (lockState.state === "stale") {
        if (!options.clearStaleLock) {
            logError(`${label}: a STALE lock is present (${lockState.reason}). If you are sure no runner is alive, re-run with --clear-stale-lock. Refusing to guess (fail-closed).`);
            return exports.LONG_RUN_EXIT.unusable;
        }
        (0, node_fs_1.rmSync)(paths.lockPath, { force: true });
        log(`${label}: cleared stale lock (${lockState.reason}).`);
    }
    (0, node_fs_1.mkdirSync)(paths.receiptsDir, { recursive: true });
    (0, node_fs_1.mkdirSync)(paths.costsDir, { recursive: true });
    const startedAt = new Date().toISOString();
    writeLock(paths.lockPath, startedAt);
    // Torn-tail REPAIR happens here -- only now, holding the lock, is it safe to
    // truncate: without the lock the "torn tail" could be a live runner's
    // in-progress append. Appending without truncating would weld the next
    // record onto the fragment and corrupt the ledger permanently.
    if (ledger.droppedTornTail) {
        (0, node_fs_1.truncateSync)(paths.ledgerPath, ledger.repairByteLength);
        log(`${label}: ledger repaired -- truncated the torn final line at byte ${ledger.repairByteLength}; every remaining line is a complete record.`);
    }
    const heartbeat = setInterval(() => {
        try {
            writeLock(paths.lockPath, startedAt);
        }
        catch {
            /* heartbeat failure must never kill the run */
        }
    }, exports.LONG_RUN_HEARTBEAT_MS);
    heartbeat.unref();
    appendLongRunLedger(paths.ledgerPath, { type: "run_started", ts: startedAt, pid: process.pid, host: (0, node_os_1.hostname)(), mode: options.mode });
    writeStateSnapshot(paths, "running");
    const children = new Set();
    const activeAttemptIds = new Set();
    let interrupted = false;
    const onSignal = (signal) => {
        interrupted = true;
        try {
            appendLongRunLedger(paths.ledgerPath, {
                type: "run_interrupted",
                ts: new Date().toISOString(),
                signal,
                inFlightAttemptIds: [...activeAttemptIds],
            });
        }
        catch {
            /* best effort -- orphaned attempt_start records already make re-run safe */
        }
        for (const child of children) {
            try {
                child.kill("SIGTERM");
            }
            catch {
                /* already gone */
            }
        }
        try {
            writeStateSnapshot(paths, "interrupted");
        }
        catch {
            /* snapshot is convenience only */
        }
        (0, node_fs_1.rmSync)(paths.lockPath, { force: true });
        logError(`${label}: interrupted by ${signal}. The append-only ledger keeps every finished verdict; \`proofloop run resume\` continues from the first non-terminal attempt.`);
        process.exit(exports.LONG_RUN_EXIT.interrupted);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    // ---- worker pool ----
    const queue = progress.attempts.filter((attempt) => !attempt.terminal);
    const totalTargets = plan.attempts.length;
    let spentUsd = progress.spentUsd;
    let reservedUsd = 0;
    let budgetStopped = false;
    log(`${label}: run "${paths.runId}" -- ${queue.length} of ${totalTargets} attempts remaining, spent ${usd(spentUsd)} of ${usd(plan.budgetUsd)} budget, concurrency ${plan.concurrency}.`);
    const runOneTry = async (attempt) => {
        const spec = attempt.spec;
        const tryNumber = attempt.nextTry;
        attempt.nextTry += 1;
        const receiptFile = (0, node_path_1.join)(paths.receiptsDir, `${sanitizeFileStem(spec.id)}.try${tryNumber}.json`);
        const costFile = (0, node_path_1.join)(paths.costsDir, `${sanitizeFileStem(spec.id)}.try${tryNumber}.json`);
        appendLongRunLedger(paths.ledgerPath, { type: "attempt_start", ts: new Date().toISOString(), attemptId: spec.id, try: tryNumber });
        activeAttemptIds.add(spec.id);
        const outcome = await spawnAttemptTry(spec, {
            ...process.env,
            PROOFLOOP_RUN_ID: paths.runId,
            PROOFLOOP_ATTEMPT_ID: spec.id,
            PROOFLOOP_ATTEMPT_TRY: String(tryNumber),
            PROOFLOOP_RECEIPT_FILE: receiptFile,
            PROOFLOOP_COST_FILE: costFile,
        }, root, children);
        activeAttemptIds.delete(spec.id);
        if (interrupted)
            return; // the signal handler already recorded + exited path; be inert.
        const actual = readActualCost(costFile);
        const costUsd = actual ? actual.costUsd : spec.estCostUsd;
        const costSource = actual ? "actual" : "estimate";
        const endRecord = {
            type: "attempt_end",
            ts: new Date().toISOString(),
            attemptId: spec.id,
            try: tryNumber,
            verdict: outcome.verdict,
            exitCode: outcome.exitCode,
            durationMs: outcome.durationMs,
            costUsd,
            costSource,
            receiptPath: (0, node_fs_1.existsSync)(receiptFile) ? relativeToRunDir(paths, receiptFile) : null,
            stdoutTail: capTail(redactLongRunText(outcome.stdoutTail), exports.LONG_RUN_SNIPPET_MAX_CHARS),
            stderrTail: capTail(redactLongRunText(outcome.stderrTail), exports.LONG_RUN_SNIPPET_MAX_CHARS),
        };
        appendLongRunLedger(paths.ledgerPath, endRecord);
        attempt.ends.push(endRecord);
        attempt.passed = attempt.passed || outcome.verdict === "pass";
        attempt.terminal = attempt.passed || attempt.ends.length >= plan.maxRetries + 1;
        spentUsd += costUsd;
        log(`${label}: [${spec.id}] try ${tryNumber}/${plan.maxRetries + 1} ${outcome.verdict.toUpperCase()} (exit ${outcome.exitCode ?? "spawn-error"}, ${outcome.durationMs}ms, ${usd(costUsd)} ${costSource}) -- spent ${usd(spentUsd)}/${usd(plan.budgetUsd)}`);
    };
    const worker = async () => {
        while (!interrupted && !budgetStopped) {
            const attempt = queue.shift();
            if (!attempt)
                return;
            while (!attempt.terminal && !interrupted) {
                // BUDGET ENFORCEMENT (reserve -> settle): settled spend + estimates
                // reserved by in-flight tries + this try's estimate must fit.
                if (spentUsd + reservedUsd + attempt.spec.estCostUsd > plan.budgetUsd + 1e-9) {
                    if (!budgetStopped) {
                        budgetStopped = true;
                        appendLongRunLedger(paths.ledgerPath, {
                            type: "budget_exhausted",
                            ts: new Date().toISOString(),
                            spentUsd,
                            budgetUsd: plan.budgetUsd,
                            nextAttemptId: attempt.spec.id,
                            nextTryEstCostUsd: attempt.spec.estCostUsd,
                        });
                        logError(`${label}: BUDGET EXHAUSTED -- spent ${usd(spentUsd)} of ${usd(plan.budgetUsd)}; next try of [${attempt.spec.id}] estimates ${usd(attempt.spec.estCostUsd)} and would cross the line. Stopping honestly (exit ${exports.LONG_RUN_EXIT.budgetExhausted}); NOT silently skipping. Raise budgetUsd in ${relativeToRunDir(paths, paths.planPath)} and \`proofloop run resume\` to continue.`);
                    }
                    return;
                }
                reservedUsd += attempt.spec.estCostUsd;
                try {
                    await runOneTry(attempt);
                }
                finally {
                    reservedUsd -= attempt.spec.estCostUsd;
                }
            }
        }
    };
    try {
        const workers = Array.from({ length: Math.min(plan.concurrency, queue.length) }, () => worker());
        await Promise.all(workers);
    }
    finally {
        clearInterval(heartbeat);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        (0, node_fs_1.rmSync)(paths.lockPath, { force: true });
    }
    const final = deriveLongRunProgress(plan, readLongRunLedger(paths.ledgerPath).records);
    if (budgetStopped) {
        writeStateSnapshot(paths, "budget_exhausted");
        printProgressSummary(log, plan, final);
        return exports.LONG_RUN_EXIT.budgetExhausted;
    }
    appendLongRunLedger(paths.ledgerPath, {
        type: "run_completed",
        ts: new Date().toISOString(),
        passed: final.passed,
        failed: final.failedTerminal,
        spentUsd: final.spentUsd,
        allPassed: final.failedTerminal === 0 && final.remaining === 0,
    });
    writeStateSnapshot(paths, final.failedTerminal === 0 ? "completed" : "failed");
    log(`${label}: run "${paths.runId}" complete.`);
    printProgressSummary(log, plan, final);
    return final.failedTerminal === 0 ? exports.LONG_RUN_EXIT.allPassed : exports.LONG_RUN_EXIT.failures;
}
function sanitizeFileStem(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, "_");
}
function relativeToRunDir(paths, absolute) {
    return absolute.startsWith(paths.runDir) ? absolute.slice(paths.runDir.length + 1).replace(/\\/g, "/") : absolute;
}
function printProgressSummary(log, plan, progress) {
    log(`  attempts: ${plan.attempts.length} total -- ${progress.passed} passed, ${progress.failedTerminal} failed (retries exhausted), ${progress.remaining} remaining`);
    log(`  spend:    ${usd(progress.spentUsd)} of ${usd(plan.budgetUsd)} budget (${usd(progress.measuredCostUsd)} measured actual, ${usd(progress.estimateFallbackCostUsd)} estimate fallback)`);
}
// ---------------------------------------------------------------------------
// `proofloop run status [--run <id>] [--clear-stale-lock]`
function runLongRunStatus(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const root = (0, node_path_1.resolve)(options.root);
    const paths = resolveLongRunPaths(root, options.runId);
    if (!paths) {
        logError(`proofloop run status: no run found${options.runId ? ` with id "${options.runId}"` : ""}. Run \`proofloop run init --plan <plan.json>\` first.`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    let plan;
    let ledger;
    try {
        plan = parseLongRunPlan(JSON.parse((0, node_fs_1.readFileSync)(paths.planPath, "utf8")));
        ledger = readLongRunLedger(paths.ledgerPath);
    }
    catch (error) {
        logError(`proofloop run status: ${error instanceof Error ? error.message : String(error)}`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    const progress = deriveLongRunProgress(plan, ledger.records);
    log(`proofloop run status: ${paths.runId}`);
    if (ledger.droppedTornTail) {
        log("  ledger:   torn final line detected (crash artifact) -- it will be dropped and the attempt re-run on resume.");
    }
    const terminal = progress.passed + progress.failedTerminal;
    log(`  attempts: ${plan.attempts.length} total | ${terminal} done (${progress.passed} passed, ${progress.failedTerminal} failed) | ${progress.remaining} remaining`);
    log(`  spend:    ${usd(progress.spentUsd)} of ${usd(plan.budgetUsd)} budget (${usd(progress.measuredCostUsd)} measured actual, ${usd(progress.estimateFallbackCostUsd)} estimate fallback)`);
    if (progress.budgetExhaustedSeen) {
        log(`  budget:   a budget_exhausted stop is recorded in the ledger. Raise budgetUsd in the run's plan.json to continue.`);
    }
    const median = medianOf(progress.durationsMs);
    if (progress.remaining > 0 && median !== undefined) {
        const etaMs = Math.ceil(progress.remaining / plan.concurrency) * median;
        log(`  eta:      ~${formatDuration(etaMs)} for ${progress.remaining} remaining (median completed try ${formatDuration(median)}, concurrency ${plan.concurrency}; rough -- assumes one try per remaining attempt).`);
    }
    else if (progress.remaining > 0) {
        log("  eta:      unknown (no completed tries to estimate from yet).");
    }
    const lockState = longRunLockState(paths.lockPath);
    if (lockState.state === "live") {
        log(`  lock:     LIVE -- pid ${lockState.lock.pid} on ${lockState.lock.host}, heartbeat ${lockState.lock.heartbeatAt}.`);
        const inFlight = progress.attempts.filter((attempt) => attempt.orphanStarts > 0 && !attempt.terminal).map((attempt) => attempt.spec.id);
        if (inFlight.length > 0)
            log(`  current:  ${inFlight.join(", ")} (attempt_start without attempt_end while a live runner holds the lock)`);
    }
    else if (lockState.state === "stale") {
        if (options.clearStaleLock) {
            (0, node_fs_1.rmSync)(paths.lockPath, { force: true });
            log(`  lock:     STALE (${lockState.reason}) -- cleared via --clear-stale-lock.`);
        }
        else {
            log(`  lock:     STALE (${lockState.reason}). Clear with \`proofloop run status --run ${paths.runId} --clear-stale-lock\` or resume with \`proofloop run resume --run ${paths.runId} --clear-stale-lock\`.`);
        }
    }
    else {
        log("  lock:     none (no runner active).");
        const unfinished = progress.attempts.filter((attempt) => attempt.orphanStarts > 0 && !attempt.terminal).map((attempt) => attempt.spec.id);
        if (unfinished.length > 0)
            log(`  note:     unfinished tries from a dead runner: ${unfinished.join(", ")} -- they re-run on resume.`);
    }
    return 0;
}
function medianOf(values) {
    if (values.length === 0)
        return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function formatDuration(ms) {
    if (ms < 1_000)
        return `${Math.round(ms)}ms`;
    const seconds = ms / 1_000;
    if (seconds < 90)
        return `${seconds.toFixed(1)}s`;
    const minutes = seconds / 60;
    if (minutes < 90)
        return `${minutes.toFixed(1)}min`;
    return `${(minutes / 60).toFixed(1)}h`;
}
// ---------------------------------------------------------------------------
// `proofloop run report [--run <id>] [--json]`
exports.LONG_RUN_REPORT_FRAMING = "Proxy product proof, NOT an official benchmark score. This report records command executions and receipts captured by the proofloop long-run runner; a pass means the attempt command exited 0. No model winner is claimed, and official scores require the official scorer (or an explicitly recorded equivalent judge contract).";
function buildLongRunReport(runId, plan, records, now = new Date()) {
    const progress = deriveLongRunProgress(plan, records);
    const emptyBucket = () => ({ attempts: 0, passed: 0, failed: 0, remaining: 0, spentUsd: 0, measuredCostUsd: 0, durations: [] });
    const familyBuckets = new Map();
    const modelBuckets = new Map();
    for (const attempt of progress.attempts) {
        for (const [key, map] of [
            [attempt.spec.family, familyBuckets],
            [attempt.spec.model, modelBuckets],
        ]) {
            const bucket = map.get(key) ?? emptyBucket();
            bucket.attempts += 1;
            if (attempt.passed)
                bucket.passed += 1;
            else if (attempt.terminal)
                bucket.failed += 1;
            else
                bucket.remaining += 1;
            for (const end of attempt.ends) {
                bucket.spentUsd += end.costUsd;
                if (end.costSource === "actual")
                    bucket.measuredCostUsd += end.costUsd;
                bucket.durations.push(end.durationMs);
            }
            map.set(key, bucket);
        }
    }
    const rate = (bucket) => {
        const terminal = bucket.passed + bucket.failed;
        return terminal === 0 ? null : round4(bucket.passed / terminal);
    };
    const perPass = (bucket) => (bucket.passed === 0 ? null : round4(bucket.spentUsd / bucket.passed));
    const families = [...familyBuckets.entries()].map(([id, bucket]) => ({
        id,
        attempts: bucket.attempts,
        passed: bucket.passed,
        failed: bucket.failed,
        remaining: bucket.remaining,
        passRate: rate(bucket),
        spentUsd: round4(bucket.spentUsd),
        costPerPassUsd: perPass(bucket),
    }));
    const modelSummaries = [...modelBuckets.entries()].map(([modelId, bucket]) => ({
        modelId,
        attempts: bucket.attempts,
        passed: bucket.passed,
        failed: bucket.failed,
        remaining: bucket.remaining,
        passRate: rate(bucket),
        spentUsd: round4(bucket.spentUsd),
        measuredCostUsd: round4(bucket.measuredCostUsd),
        avgDurationMs: bucket.durations.length === 0 ? null : Math.round(bucket.durations.reduce((a, b) => a + b, 0) / bucket.durations.length),
        costPerPassUsd: perPass(bucket),
    }));
    const triesRecorded = records.filter((record) => record.type === "attempt_end").length;
    return {
        schema: "proofloop-longrun-report-v1",
        framing: exports.LONG_RUN_REPORT_FRAMING,
        runId,
        generatedAt: now.toISOString(),
        summary: {
            attemptTargets: plan.attempts.length,
            passed: progress.passed,
            failed: progress.failedTerminal,
            remaining: progress.remaining,
            complete: progress.remaining === 0,
            allPassed: progress.remaining === 0 && progress.failedTerminal === 0,
            triesRecorded,
            spentUsd: round4(progress.spentUsd),
            budgetUsd: plan.budgetUsd,
            measuredCostUsd: round4(progress.measuredCostUsd),
            estimateFallbackCostUsd: round4(progress.estimateFallbackCostUsd),
            budgetExhausted: progress.budgetExhaustedSeen,
            interrupted: progress.interruptedSeen,
        },
        families,
        modelSummaries,
    };
}
function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}
function formatLongRunReportMarkdown(report) {
    const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
    const money = (value) => (value === null ? "n/a" : usd(value));
    const lines = [
        `# proofloop long-run report -- ${report.runId}`,
        "",
        `> ${report.framing}`,
        "",
        "## Summary",
        "",
        `- attempts: ${report.summary.attemptTargets} targets -- ${report.summary.passed} passed, ${report.summary.failed} failed (retries exhausted), ${report.summary.remaining} remaining (${report.summary.triesRecorded} tries recorded)`,
        `- spend: ${usd(report.summary.spentUsd)} of ${usd(report.summary.budgetUsd)} budget (${usd(report.summary.measuredCostUsd)} measured actual, ${usd(report.summary.estimateFallbackCostUsd)} estimate fallback)`,
        `- complete: ${report.summary.complete ? "yes" : "NO -- results below are partial"}${report.summary.budgetExhausted ? " (stopped at the budget line)" : ""}${report.summary.interrupted ? " (a run was interrupted)" : ""}`,
        "",
        "## Per family",
        "",
        "| familyId | attempts | passed | failed | remaining | passRate | spentUsd | costPerPassUsd |",
        "|---|---|---|---|---|---|---|---|",
        ...report.families.map((row) => `| ${row.id} | ${row.attempts} | ${row.passed} | ${row.failed} | ${row.remaining} | ${pct(row.passRate)} | ${usd(row.spentUsd)} | ${money(row.costPerPassUsd)} |`),
        "",
        "## Per model",
        "",
        "| modelId | attempts | passed | failed | remaining | passRate | spentUsd | measuredCostUsd | avgDurationMs | costPerPassUsd |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...report.modelSummaries.map((row) => `| ${row.modelId} | ${row.attempts} | ${row.passed} | ${row.failed} | ${row.remaining} | ${pct(row.passRate)} | ${usd(row.spentUsd)} | ${usd(row.measuredCostUsd)} | ${row.avgDurationMs ?? "n/a"} | ${money(row.costPerPassUsd)} |`),
        "",
    ];
    return lines.join("\n");
}
function runLongRunReport(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const root = (0, node_path_1.resolve)(options.root);
    const paths = resolveLongRunPaths(root, options.runId);
    if (!paths) {
        logError(`proofloop run report: no run found${options.runId ? ` with id "${options.runId}"` : ""}. Run \`proofloop run init --plan <plan.json>\` first.`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    let plan;
    let ledger;
    try {
        plan = parseLongRunPlan(JSON.parse((0, node_fs_1.readFileSync)(paths.planPath, "utf8")));
        ledger = readLongRunLedger(paths.ledgerPath);
    }
    catch (error) {
        logError(`proofloop run report: ${error instanceof Error ? error.message : String(error)}`);
        return exports.LONG_RUN_EXIT.unusable;
    }
    const report = buildLongRunReport(paths.runId, plan, ledger.records);
    const markdown = formatLongRunReportMarkdown(report);
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(paths.runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(paths.runDir, "report.md"), markdown, "utf8");
    log(options.json ? JSON.stringify(report, null, 2) : markdown);
    return 0;
}
