"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROOFLOOP_PROGRAM_EVENT_SCHEMA = exports.PROOFLOOP_PROGRAM_STATE_SCHEMA = exports.PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA = exports.PROOFLOOP_PROGRAM_PLAN_SCHEMA = void 0;
exports.runProofloopProgram = runProofloopProgram;
exports.readProofloopProgramPlan = readProofloopProgramPlan;
exports.readProofloopProgramAuthority = readProofloopProgramAuthority;
exports.programRunDir = programRunDir;
exports.programStatePath = programStatePath;
exports.programLedgerPath = programLedgerPath;
exports.isProgramTerminal = isProgramTerminal;
exports.formatProofloopProgramStatus = formatProofloopProgramStatus;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const proofReceipt_1 = require("./proofReceipt");
const nodekitProof_1 = require("./nodekitProof");
const receipts_1 = require("./receipts");
const runner_1 = require("./runner");
/**
 * P0 program supervisor.
 *
 * This is deliberately an orchestration layer over the existing durable runner:
 * each arc points at one immutable runner plan. It does not accept arbitrary
 * commands itself and it does not add a parallel task-execution engine.
 */
exports.PROOFLOOP_PROGRAM_PLAN_SCHEMA = "proofloop-program-plan-v1";
exports.PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA = "proofloop-program-authority-v1";
exports.PROOFLOOP_PROGRAM_STATE_SCHEMA = "proofloop-program-state-v1";
exports.PROOFLOOP_PROGRAM_EVENT_SCHEMA = "proofloop-program-event-v1";
const PROGRAM_ROOT = ".proofloop/programs";
const DEFAULT_LOCK_TTL_MS = 30 * 60_000;
// Program and arc identifiers become part of local durable run paths. Keep
// them portable across Windows and POSIX rather than accepting ':' or a path
// separator merely because it is convenient for a logical label.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const PLAN_KEYS = new Set(["schema", "programId", "authorityPath", "arcs"]);
const ARC_KEYS = new Set(["id", "mode", "runnerPlan", "dependsOn", "receipt", "externalEgress", "maxAttempts"]);
const AUTHORITY_KEYS = new Set(["schema", "authorityId", "allowedArcModes", "allowExternalEgress", "maxBudgetUsd", "maxAttemptsPerArc"]);
const ENVELOPE_RECEIPT_KEYS = new Set(["kind", "file"]);
const NODEAGENT_RECEIPT_KEYS = new Set(["kind", "file", "minDocuments", "minMemoryObjects"]);
const NODEKIT_RECEIPT_KEYS = new Set(["kind", "file", "candidateCommit", "minimumLevel", "compiledDefinition", "configHashFile", "discovery"]);
/** Run or resume a dependency-ordered program. P0 only permits local read/proposal arcs. */
async function runProofloopProgram(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    if (options.subcommand === "status")
        return programStatus(options);
    if (options.subcommand === "report")
        return programReport(options);
    let runId = options.runId;
    // Keep the initial fallback inside the safe run-id grammar because failures
    // must not turn a caller-supplied run id into a filesystem path.
    let runDir = programRunDir(root, "unknown");
    let lock;
    try {
        if (options.subcommand === "resume")
            runId = resolveProgramRunId(root, options.runId);
        const existingState = options.subcommand === "resume"
            ? readProgramState(programStatePath(programRunDir(root, runId)))
            : undefined;
        const planPath = resolveProgramPlanPath(options, existingState);
        const compiled = compileProgram(root, planPath);
        runId = options.subcommand === "resume" ? runId : options.runId ?? defaultProgramRunId(compiled.plan.programId);
        if (!validId(runId))
            throw new Error("program run-id must contain only letters, numbers, '.', '_', or '-'");
        runDir = programRunDir(root, runId);
        (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
        lock = acquireProgramLock(runDir, options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS, options.clearStaleLock === true);
        const repaired = repairProgramLedgerTornTail(runDir);
        if (repaired.repaired)
            appendProgramEvent(runDir, { programRunId: runId, event: "ledger_torn_tail_repaired", data: repaired });
        let state = loadOrCreateProgramState(runDir, {
            programRunId: runId,
            compiled,
            budgetUsd: initialBudget(compiled.authority, options.budgetUsd),
        });
        writeLatestProgramRun(root, runId);
        const resumeIntegrity = validateExistingProgramState(state, compiled, options.budgetUsd);
        if (resumeIntegrity) {
            state = terminalizeProgram(state, runDir, resumeIntegrity.status, resumeIntegrity.event, resumeIntegrity.message);
            return emitProgramResult(state, runDir, options, log);
        }
        const policyViolations = validateProgramAuthority(compiled);
        if (policyViolations.length > 0) {
            state = terminalizeProgram(state, runDir, "blocked_authority", "authority_policy_blocked", policyViolations.join("; "));
            return emitProgramResult(state, runDir, options, log);
        }
        if (isProgramTerminal(state.status))
            return emitProgramResult(state, runDir, options, log);
        appendProgramEvent(runDir, {
            programRunId: runId,
            event: "program_started",
            data: {
                subcommand: options.subcommand,
                budgetUsd: state.budgetUsd,
                maxArcs: options.maxArcs ?? null,
                authorityDigest: state.authorityDigest,
            },
        });
        const maxArcs = normalizeMaxArcs(options.maxArcs);
        let executed = 0;
        while (executed < maxArcs) {
            const next = nextExecutableArc(state);
            if (!next)
                break;
            const compiledArc = compiled.arcs.find((arc) => arc.plan.id === next.id);
            if (!compiledArc) {
                next.status = "failed";
                next.completedAt = nowIso();
                next.error = "Arc is missing from the compiled program.";
                state = terminalizeProgram(state, runDir, "failed_integrity", "arc_missing_from_compiled_program", next.error, next.id);
                break;
            }
            const recoveringInterruptedArc = next.status === "running";
            if (!recoveringInterruptedArc && next.attempts >= next.maxAttempts) {
                next.status = "failed";
                next.completedAt = nowIso();
                next.error = `Arc exhausted its bounded attempt limit (${next.maxAttempts}) and will not be requeued automatically.`;
                state = terminalizeProgram(state, runDir, "failed", "arc_attempt_limit_reached", next.error, next.id);
                break;
            }
            if (!recoveringInterruptedArc && roundMoney(state.spentEstimatedUsd + next.estimatedCostUsd) > state.budgetUsd) {
                next.status = "blocked_budget";
                next.completedAt = nowIso();
                next.error = `Program budget would be exceeded by arc estimate $${next.estimatedCostUsd.toFixed(4)}.`;
                state = terminalizeProgram(state, runDir, "blocked_budget", "budget_kill_switch", next.error, next.id);
                break;
            }
            if (recoveringInterruptedArc) {
                appendProgramEvent(runDir, {
                    programRunId: runId,
                    event: "arc_recovery_requested",
                    arcId: next.id,
                    data: {
                        runnerRunId: next.runnerRunId,
                        attempt: next.attempts,
                        note: "Only interrupted running work may resume. Failed arcs remain terminal and are never automatically requeued.",
                    },
                });
            }
            else {
                state.status = "running";
                next.status = "running";
                next.attempts += 1;
                next.startedAt = nowIso();
                state.updatedAt = next.startedAt;
                writeProgramState(runDir, state);
                appendProgramEvent(runDir, {
                    programRunId: runId,
                    event: "arc_started",
                    arcId: next.id,
                    data: {
                        mode: next.mode,
                        runnerPlanDigest: next.runnerPlanDigest,
                        estimatedCostUsd: next.estimatedCostUsd,
                        attempt: next.attempts,
                        maxAttempts: next.maxAttempts,
                    },
                });
            }
            const runnerAlreadyExists = (0, node_fs_1.existsSync)((0, runner_1.runnerStatePath)((0, runner_1.runnerRunDir)(root, next.runnerRunId)));
            const runner = await (0, runner_1.runProofloopRunner)({
                root,
                subcommand: runnerAlreadyExists ? "resume" : "run",
                ...(runnerAlreadyExists ? {} : { planPath: compiledArc.runnerPlanPath }),
                runId: next.runnerRunId,
                budgetUsd: roundMoney(state.budgetUsd - state.spentEstimatedUsd),
                clearStaleLock: options.clearStaleLock === true,
                log: () => { },
                logError: () => { },
            });
            const priorRunnerSpend = next.runnerSpentEstimatedUsd ?? 0;
            const currentRunnerSpend = runner.state.spentEstimatedUsd;
            if (!nonNegativeFiniteNumber(currentRunnerSpend) || currentRunnerSpend < priorRunnerSpend) {
                next.status = "failed";
                next.completedAt = nowIso();
                next.error = "Runner spend observation is invalid or regressed; refusing to continue an unverifiable program run.";
                state = terminalizeProgram(state, runDir, "failed_integrity", "runner_spend_integrity_failed", next.error, next.id, {
                    priorRunnerSpend,
                    currentRunnerSpend,
                });
                break;
            }
            const runnerSpendDelta = roundMoney(currentRunnerSpend - priorRunnerSpend);
            state.spentEstimatedUsd = roundMoney(state.spentEstimatedUsd + runnerSpendDelta);
            next.runnerSpentEstimatedUsd = currentRunnerSpend;
            next.completedAt = nowIso();
            state.updatedAt = next.completedAt;
            writeProgramState(runDir, state);
            if (runner.state.status !== "passed") {
                next.status = runner.state.status === "blocked_budget" ? "blocked_budget" : "failed";
                next.error = `Runner ended ${runner.state.status}; runner run ${next.runnerRunId}.`;
                const terminal = next.status === "blocked_budget" ? "blocked_budget" : "failed";
                state = terminalizeProgram(state, runDir, terminal, "arc_runner_failed", next.error, next.id, {
                    runnerStatus: runner.state.status,
                    runnerRunId: next.runnerRunId,
                });
                break;
            }
            const receipt = verifyProgramReceipt(root, compiledArc.plan.receipt);
            if (receipt) {
                next.receipt = receipt;
                appendProgramEvent(runDir, {
                    programRunId: runId,
                    event: receipt.ok ? "receipt_verified" : "receipt_verification_failed",
                    arcId: next.id,
                    data: { kind: receipt.kind, file: receipt.file, errors: receipt.errors },
                });
                if (!receipt.ok) {
                    next.status = "failed";
                    next.error = `Required receipt verification failed: ${receipt.errors.join("; ")}`;
                    state = terminalizeProgram(state, runDir, "failed", "arc_receipt_failed", next.error, next.id);
                    break;
                }
            }
            next.status = "passed";
            writeProgramState(runDir, state);
            appendProgramEvent(runDir, {
                programRunId: runId,
                event: "arc_passed",
                arcId: next.id,
                data: { runnerRunId: next.runnerRunId, spentEstimatedUsd: state.spentEstimatedUsd },
            });
            executed += 1;
        }
        if (!isProgramTerminal(state.status)) {
            if (state.arcStates.every((arc) => arc.status === "passed")) {
                state = terminalizeProgram(state, runDir, "certified", "program_certified", "Every program arc and configured receipt hook passed.");
            }
            else if (state.arcStates.some((arc) => arc.status === "failed")) {
                state = terminalizeProgram(state, runDir, "failed", "program_failed", "An arc failed and P0 does not automatically requeue failed work.");
            }
            else if (state.arcStates.some((arc) => arc.status === "blocked_budget")) {
                state = terminalizeProgram(state, runDir, "blocked_budget", "program_budget_blocked", "A program arc is blocked by the approved budget.");
            }
            else if (executed >= maxArcs) {
                state.status = "paused";
                state.updatedAt = nowIso();
                writeProgramState(runDir, state);
                appendProgramEvent(runDir, { programRunId: runId, event: "program_paused", data: { maxArcs } });
            }
            else {
                state = terminalizeProgram(state, runDir, "failed_integrity", "no_dependency_safe_arc", "No dependency-safe queued arc remains; inspect the persisted program state.");
            }
        }
        return emitProgramResult(state, runDir, options, log);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`proofloop program: ${message}`);
        return {
            state: emptyProgramErrorState(runId ?? "unknown", message),
            runDir,
            ledgerPath: programLedgerPath(runDir),
            exitCode: 2,
        };
    }
    finally {
        lock?.release();
    }
}
function readProofloopProgramPlan(rootInput, planPathInput) {
    const root = (0, node_path_1.resolve)(rootInput);
    const planPath = resolveProgramRepoFile(root, planPathInput, "program plan", { allowAbsoluteInsideRoot: true });
    const raw = (0, node_fs_1.readFileSync)(planPath, "utf8").replace(/^\uFEFF/, "");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`program plan must be JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed))
        throw new Error("program plan must be an object");
    rejectUnknownKeys(parsed, PLAN_KEYS, "program plan");
    if (parsed.schema !== exports.PROOFLOOP_PROGRAM_PLAN_SCHEMA)
        throw new Error(`program plan schema must be ${exports.PROOFLOOP_PROGRAM_PLAN_SCHEMA}`);
    if (!validId(parsed.programId))
        throw new Error("program plan programId is required");
    if (!safeRepoRelativePath(parsed.authorityPath))
        throw new Error("program plan authorityPath must be a safe repo-relative path");
    if (!Array.isArray(parsed.arcs) || parsed.arcs.length === 0)
        throw new Error("program plan must include at least one arc");
    const ids = new Set();
    const arcs = parsed.arcs.map((value, index) => parseProgramArc(value, index, ids));
    validateArcGraph(arcs);
    return {
        schema: exports.PROOFLOOP_PROGRAM_PLAN_SCHEMA,
        programId: parsed.programId,
        authorityPath: parsed.authorityPath,
        arcs,
    };
}
function readProofloopProgramAuthority(rootInput, authorityPathInput) {
    const root = (0, node_path_1.resolve)(rootInput);
    const authorityPath = resolveProgramRepoFile(root, authorityPathInput, "program authority");
    const raw = (0, node_fs_1.readFileSync)(authorityPath, "utf8").replace(/^\uFEFF/, "");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`program authority must be JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed))
        throw new Error("program authority must be an object");
    rejectUnknownKeys(parsed, AUTHORITY_KEYS, "program authority");
    if (parsed.schema !== exports.PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA)
        throw new Error(`program authority schema must be ${exports.PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA}`);
    if (!validId(parsed.authorityId))
        throw new Error("program authority authorityId is required");
    if (!Array.isArray(parsed.allowedArcModes) || parsed.allowedArcModes.length === 0)
        throw new Error("program authority allowedArcModes is required");
    const allowedArcModes = parsed.allowedArcModes.map((mode) => parseArcMode(mode, "program authority allowedArcModes"));
    if (new Set(allowedArcModes).size !== allowedArcModes.length)
        throw new Error("program authority allowedArcModes must be unique");
    if (parsed.allowExternalEgress !== false)
        throw new Error("program authority allowExternalEgress must be false in P0");
    if (!nonNegativeFiniteNumber(parsed.maxBudgetUsd))
        throw new Error("program authority maxBudgetUsd must be a non-negative finite number");
    if (!positiveInteger(parsed.maxAttemptsPerArc))
        throw new Error("program authority maxAttemptsPerArc must be a positive integer");
    return {
        schema: exports.PROOFLOOP_PROGRAM_AUTHORITY_SCHEMA,
        authorityId: parsed.authorityId,
        allowedArcModes,
        allowExternalEgress: false,
        maxBudgetUsd: parsed.maxBudgetUsd,
        maxAttemptsPerArc: parsed.maxAttemptsPerArc,
    };
}
function programRunDir(rootInput, runId) {
    if (!validId(runId))
        throw new Error("program run-id must contain only letters, numbers, '.', '_', or '-'");
    return (0, node_path_1.join)((0, node_path_1.resolve)(rootInput), PROGRAM_ROOT, "runs", runId);
}
function programStatePath(runDir) {
    return (0, node_path_1.join)(runDir, "state.json");
}
function programLedgerPath(runDir) {
    return (0, node_path_1.join)(runDir, "ledger.jsonl");
}
function isProgramTerminal(status) {
    return status === "certified" || status === "failed" || status === "failed_integrity" || status === "blocked_budget" || status === "blocked_authority";
}
function formatProofloopProgramStatus(state, runDir) {
    const counts = state.arcStates.reduce((value, arc) => {
        value[arc.status] += 1;
        return value;
    }, { queued: 0, running: 0, passed: 0, failed: 0, blocked_budget: 0, blocked_authority: 0 });
    return [
        `proofloop program: ${state.programRunId}`,
        `program=${state.programId} status=${state.status}`,
        `budget=$${state.budgetUsd.toFixed(4)} spent_est=$${state.spentEstimatedUsd.toFixed(4)}`,
        `arcs passed=${counts.passed} queued=${counts.queued} running=${counts.running} failed=${counts.failed} blocked_budget=${counts.blocked_budget} blocked_authority=${counts.blocked_authority}`,
        `authorityDigest=${state.authorityDigest}`,
        `state=${programStatePath(runDir)}`,
        `ledger=${programLedgerPath(runDir)}`,
    ].join("\n");
}
function compileProgram(root, planPathInput) {
    const planPath = resolveProgramRepoFile(root, planPathInput, "program plan", { allowAbsoluteInsideRoot: true });
    const plan = readProofloopProgramPlan(root, planPath);
    const authorityPath = resolveProgramRepoFile(root, plan.authorityPath, "program authority");
    const authority = readProofloopProgramAuthority(root, plan.authorityPath);
    const arcsById = new Map(plan.arcs.map((arc) => [arc.id, arc]));
    const orderedIds = stableTopologicalArcOrder(plan.arcs);
    const arcs = orderedIds.map((id) => {
        const arc = arcsById.get(id);
        const runnerPlanPath = resolveProgramRepoFile(root, arc.runnerPlan, `runner plan for arc ${arc.id}`);
        const runnerPlan = (0, runner_1.readRunnerPlan)(runnerPlanPath);
        return {
            plan: arc,
            runnerPlanPath,
            runnerPlan,
            runnerPlanDigest: (0, proofReceipt_1.sha256CanonicalJson)(runnerPlan),
            estimatedCostUsd: roundMoney(runnerPlan.tasks.reduce((sum, task) => sum + (task.estimatedCostUsd ?? 0), 0)),
        };
    });
    const authorityDigest = (0, proofReceipt_1.sha256CanonicalJson)(authority);
    const planDigest = (0, proofReceipt_1.sha256CanonicalJson)({
        plan,
        arcs: arcs.map((arc) => ({
            id: arc.plan.id,
            runnerPlan: arc.plan.runnerPlan,
            runnerPlanDigest: arc.runnerPlanDigest,
            estimatedCostUsd: arc.estimatedCostUsd,
        })),
    });
    return { plan, planPath, authorityPath, authority, authorityDigest, arcs, planDigest };
}
function parseProgramArc(value, index, ids) {
    if (!isRecord(value))
        throw new Error(`program arc ${index} must be an object`);
    rejectUnknownKeys(value, ARC_KEYS, `program arc ${index}`);
    if (!validId(value.id))
        throw new Error(`program arc ${index} id is required`);
    if (ids.has(value.id))
        throw new Error(`duplicate program arc id: ${value.id}`);
    ids.add(value.id);
    const mode = parseArcMode(value.mode, `program arc ${value.id} mode`);
    if (!safeRepoRelativePath(value.runnerPlan))
        throw new Error(`program arc ${value.id} runnerPlan must be a safe repo-relative path`);
    const dependsOn = parseIdArray(value.dependsOn, `program arc ${value.id} dependsOn`);
    if (new Set(dependsOn).size !== dependsOn.length)
        throw new Error(`program arc ${value.id} dependsOn must be unique`);
    if (dependsOn.includes(value.id))
        throw new Error(`program arc ${value.id} cannot depend on itself`);
    if (value.externalEgress !== undefined && typeof value.externalEgress !== "boolean")
        throw new Error(`program arc ${value.id} externalEgress must be boolean`);
    const maxAttempts = value.maxAttempts === undefined ? undefined : requirePositiveInteger(value.maxAttempts, `program arc ${value.id} maxAttempts`);
    const receipt = value.receipt === undefined ? undefined : parseReceiptHook(value.receipt, `program arc ${value.id} receipt`);
    return {
        id: value.id,
        mode,
        runnerPlan: value.runnerPlan,
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        ...(receipt ? { receipt } : {}),
        ...(value.externalEgress === true ? { externalEgress: true } : {}),
        ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    };
}
function parseReceiptHook(value, label) {
    if (!isRecord(value))
        throw new Error(`${label} must be an object`);
    if (value.kind !== "proofloop-envelope" && value.kind !== "nodeagent-ingestion" && value.kind !== "nodekit-proof") {
        throw new Error(`${label} kind must be proofloop-envelope, nodeagent-ingestion, or nodekit-proof`);
    }
    const allowedKeys = value.kind === "proofloop-envelope"
        ? ENVELOPE_RECEIPT_KEYS
        : value.kind === "nodeagent-ingestion"
            ? NODEAGENT_RECEIPT_KEYS
            : NODEKIT_RECEIPT_KEYS;
    rejectUnknownKeys(value, allowedKeys, label);
    if (!safeRepoRelativePath(value.file))
        throw new Error(`${label} file must be a safe repo-relative path`);
    if (value.kind === "proofloop-envelope") {
        return { kind: value.kind, file: value.file };
    }
    if (value.kind === "nodekit-proof") {
        if (!validGitCommit(value.candidateCommit)) {
            throw new Error(`${label} candidateCommit must be a lowercase 40-64 character Git SHA`);
        }
        if (value.minimumLevel !== undefined && value.minimumLevel !== "local-ready" && value.minimumLevel !== "release-ready") {
            throw new Error(`${label} minimumLevel must be local-ready or release-ready`);
        }
        const compiledDefinition = value.compiledDefinition;
        const configHashFile = value.configHashFile;
        const discovery = value.discovery;
        for (const [field, path] of [
            ["compiledDefinition", compiledDefinition],
            ["configHashFile", configHashFile],
            ["discovery", discovery],
        ]) {
            if (path !== undefined && !safeRepoRelativePath(path))
                throw new Error(`${label} ${field} must be a safe repo-relative path`);
        }
        return {
            kind: value.kind,
            file: value.file,
            candidateCommit: value.candidateCommit,
            ...(value.minimumLevel !== undefined ? { minimumLevel: value.minimumLevel } : {}),
            ...(typeof compiledDefinition === "string" ? { compiledDefinition } : {}),
            ...(typeof configHashFile === "string" ? { configHashFile } : {}),
            ...(typeof discovery === "string" ? { discovery } : {}),
        };
    }
    const minDocuments = value.minDocuments === undefined ? undefined : requireNonNegativeInteger(value.minDocuments, `${label} minDocuments`);
    const minMemoryObjects = value.minMemoryObjects === undefined ? undefined : requireNonNegativeInteger(value.minMemoryObjects, `${label} minMemoryObjects`);
    return {
        kind: value.kind,
        file: value.file,
        ...(minDocuments !== undefined ? { minDocuments } : {}),
        ...(minMemoryObjects !== undefined ? { minMemoryObjects } : {}),
    };
}
function validateArcGraph(arcs) {
    const ids = new Set(arcs.map((arc) => arc.id));
    for (const arc of arcs) {
        for (const dependency of arc.dependsOn ?? []) {
            if (!ids.has(dependency))
                throw new Error(`program arc ${arc.id} depends on unknown arc ${dependency}`);
        }
    }
    stableTopologicalArcOrder(arcs);
}
/** Stable Kahn ordering, intentionally matching the dependency semantics used by Solo handoff compilation. */
function stableTopologicalArcOrder(arcs) {
    const originalIndex = new Map(arcs.map((arc, index) => [arc.id, index]));
    const indegree = new Map(arcs.map((arc) => [arc.id, arc.dependsOn?.length ?? 0]));
    const dependents = new Map();
    for (const arc of arcs) {
        for (const dependency of arc.dependsOn ?? []) {
            const values = dependents.get(dependency) ?? [];
            values.push(arc.id);
            dependents.set(dependency, values);
        }
    }
    const available = arcs.filter((arc) => indegree.get(arc.id) === 0).map((arc) => arc.id);
    const ordered = [];
    while (available.length > 0) {
        available.sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
        const id = available.shift();
        ordered.push(id);
        for (const dependent of dependents.get(id) ?? []) {
            const next = (indegree.get(dependent) ?? 0) - 1;
            indegree.set(dependent, next);
            if (next === 0)
                available.push(dependent);
        }
    }
    if (ordered.length !== arcs.length) {
        const cyclic = arcs.filter((arc) => !ordered.includes(arc.id)).map((arc) => arc.id);
        throw new Error(`program arc graph contains a cycle: ${cyclic.join(", ")}`);
    }
    return ordered;
}
function initialBudget(authority, requestedBudget) {
    if (requestedBudget === undefined)
        return authority.maxBudgetUsd;
    if (!nonNegativeFiniteNumber(requestedBudget))
        throw new Error("program --budget-usd must be a non-negative finite number");
    if (requestedBudget > authority.maxBudgetUsd)
        throw new Error("program --budget-usd cannot exceed the approved authority maxBudgetUsd");
    return requestedBudget;
}
function loadOrCreateProgramState(runDir, args) {
    const statePath = programStatePath(runDir);
    const existing = readProgramState(statePath);
    if (existing)
        return existing;
    if ((0, node_fs_1.existsSync)(statePath)) {
        throw new Error("program state is unreadable or corrupt; refusing to overwrite an existing run");
    }
    const now = nowIso();
    const state = {
        schema: exports.PROOFLOOP_PROGRAM_STATE_SCHEMA,
        programRunId: args.programRunId,
        programId: args.compiled.plan.programId,
        planPath: args.compiled.planPath,
        planDigest: args.compiled.planDigest,
        authorityPath: args.compiled.authorityPath,
        authorityDigest: args.compiled.authorityDigest,
        budgetUsd: args.budgetUsd,
        spentEstimatedUsd: 0,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        arcStates: args.compiled.arcs.map((arc) => ({
            id: arc.plan.id,
            mode: arc.plan.mode,
            dependsOn: [...(arc.plan.dependsOn ?? [])],
            runnerPlanPath: arc.runnerPlanPath,
            runnerPlanDigest: arc.runnerPlanDigest,
            runnerRunId: `${args.programRunId}-${arc.plan.id}`,
            estimatedCostUsd: arc.estimatedCostUsd,
            runnerSpentEstimatedUsd: 0,
            maxAttempts: Math.min(arc.plan.maxAttempts ?? 1, args.compiled.authority.maxAttemptsPerArc),
            attempts: 0,
            status: "queued",
        })),
    };
    writeProgramState(runDir, state);
    return state;
}
function validateExistingProgramState(state, compiled, requestedBudget) {
    if (state.schema !== exports.PROOFLOOP_PROGRAM_STATE_SCHEMA)
        return { status: "failed_integrity", event: "program_state_schema_mismatch", message: "Persisted program state has an unsupported schema." };
    if (!validId(state.programRunId))
        return { status: "failed_integrity", event: "program_state_run_id_invalid", message: "Persisted program state has an invalid run ID." };
    if (state.programId !== compiled.plan.programId)
        return { status: "failed_integrity", event: "program_id_changed", message: "Program ID changed for an existing run." };
    if (state.planPath !== compiled.planPath || state.authorityPath !== compiled.authorityPath) {
        return { status: "failed_integrity", event: "program_source_path_changed", message: "Persisted program source paths do not match the compiled program." };
    }
    if (state.planDigest !== compiled.planDigest)
        return { status: "failed_integrity", event: "program_plan_changed", message: "Program plan or referenced runner plan changed for an existing run." };
    if (state.authorityDigest !== compiled.authorityDigest)
        return { status: "blocked_authority", event: "authority_digest_changed", message: "Authority changed after this run was created; a new approved program run is required." };
    if (!nonNegativeFiniteNumber(state.budgetUsd) || !nonNegativeFiniteNumber(state.spentEstimatedUsd) || state.spentEstimatedUsd > state.budgetUsd) {
        return { status: "failed_integrity", event: "program_budget_state_invalid", message: "Persisted program budget state is invalid." };
    }
    if (!isProofloopProgramStatus(state.status) || !Array.isArray(state.arcStates) || state.arcStates.length !== compiled.arcs.length) {
        return { status: "failed_integrity", event: "program_state_shape_invalid", message: "Persisted program state does not match the compiled arc set." };
    }
    for (let index = 0; index < compiled.arcs.length; index += 1) {
        const persisted = state.arcStates[index];
        const expected = compiled.arcs[index];
        if (!persisted || persisted.id !== expected.plan.id || persisted.mode !== expected.plan.mode
            || !sameStringArray(persisted.dependsOn, expected.plan.dependsOn ?? [])
            || persisted.runnerPlanPath !== expected.runnerPlanPath
            || persisted.runnerPlanDigest !== expected.runnerPlanDigest
            || persisted.runnerRunId !== `${state.programRunId}-${expected.plan.id}`
            || persisted.estimatedCostUsd !== expected.estimatedCostUsd
            || persisted.maxAttempts !== Math.min(expected.plan.maxAttempts ?? 1, compiled.authority.maxAttemptsPerArc)
            || !nonNegativeInteger(persisted.attempts)
            || persisted.attempts > persisted.maxAttempts
            || !isProofloopProgramArcStatus(persisted.status)
            || (persisted.runnerSpentEstimatedUsd !== undefined && !nonNegativeFiniteNumber(persisted.runnerSpentEstimatedUsd))) {
            return { status: "failed_integrity", event: "program_arc_state_invalid", message: `Persisted state for arc ${expected.plan.id} does not match the compiled program.` };
        }
    }
    if (requestedBudget !== undefined && requestedBudget !== state.budgetUsd)
        return { status: "failed_integrity", event: "program_budget_changed", message: "Program budget is immutable after a run starts." };
    return undefined;
}
function validateProgramAuthority(compiled) {
    const errors = [];
    if (compiled.authority.allowExternalEgress !== false)
        errors.push("P0 authority must prohibit external egress");
    for (const arc of compiled.arcs) {
        if (!compiled.authority.allowedArcModes.includes(arc.plan.mode))
            errors.push(`arc ${arc.plan.id} mode ${arc.plan.mode} is not authorized`);
        if (arc.plan.externalEgress === true)
            errors.push(`arc ${arc.plan.id} declares external egress, which P0 prohibits`);
        const requestedAttempts = arc.plan.maxAttempts ?? 1;
        if (requestedAttempts > compiled.authority.maxAttemptsPerArc) {
            errors.push(`arc ${arc.plan.id} maxAttempts ${requestedAttempts} exceeds authority maxAttemptsPerArc ${compiled.authority.maxAttemptsPerArc}`);
        }
    }
    return errors;
}
function nextExecutableArc(state) {
    const interrupted = state.arcStates.find((arc) => arc.status === "running");
    if (interrupted)
        return interrupted;
    const byId = new Map(state.arcStates.map((arc) => [arc.id, arc]));
    return state.arcStates.find((arc) => arc.status === "queued" && arc.dependsOn.every((id) => byId.get(id)?.status === "passed"));
}
function verifyProgramReceipt(root, hook) {
    if (!hook)
        return undefined;
    if (hook.kind === "proofloop-envelope") {
        const result = (0, proofReceipt_1.verifyProofReceiptEnvelopeFile)({ root, filePath: hook.file });
        return {
            kind: hook.kind,
            file: hook.file,
            ok: result.ok,
            errors: result.errors.map((entry) => `${entry.code}: ${entry.message}`),
        };
    }
    if (hook.kind === "nodekit-proof") {
        const result = (0, nodekitProof_1.verifyNodekitProofBinding)({
            root,
            releaseProofPath: hook.file,
            candidateCommit: hook.candidateCommit,
            ...(hook.minimumLevel !== undefined ? { minimumLevel: hook.minimumLevel } : {}),
            ...(hook.compiledDefinition !== undefined ? { compiledDefinitionPath: hook.compiledDefinition } : {}),
            ...(hook.configHashFile !== undefined ? { configHashPath: hook.configHashFile } : {}),
            ...(hook.discovery !== undefined ? { discoveryPath: hook.discovery } : {}),
        });
        return {
            kind: hook.kind,
            file: hook.file,
            ok: result.ok,
            errors: [
                ...result.errors,
                ...result.gateReceipts.flatMap((receipt) => receipt.errors.map((error) => `${receipt.id}: ${error}`)),
            ],
        };
    }
    const result = (0, receipts_1.verifyReceiptFile)({
        root,
        filePath: hook.file,
        kind: "nodeagent-ingestion",
        ...(hook.minDocuments !== undefined ? { minDocuments: hook.minDocuments } : {}),
        ...(hook.minMemoryObjects !== undefined ? { minMemoryObjects: hook.minMemoryObjects } : {}),
    });
    return {
        kind: hook.kind,
        file: hook.file,
        ok: result.ok,
        errors: result.checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`),
    };
}
function validGitCommit(value) {
    return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
}
function resolveProgramPlanPath(options, existing) {
    if (options.subcommand === "resume") {
        if (!existing)
            throw new Error("cannot resume: missing program state");
        return existing.planPath;
    }
    if (!options.planPath)
        throw new Error("program run requires --plan <file>");
    return options.planPath;
}
function resolveProgramRunId(root, runId) {
    const resolved = runId && runId !== "latest"
        ? runId
        : (() => {
            const latestPath = (0, node_path_1.join)(root, PROGRAM_ROOT, "latest");
            if (!(0, node_fs_1.existsSync)(latestPath))
                throw new Error("no latest program run exists");
            return (0, node_fs_1.readFileSync)(latestPath, "utf8").trim();
        })();
    if (!validId(resolved))
        throw new Error("program run-id must contain only letters, numbers, '.', '_', or '-'");
    return resolved;
}
function programStatus(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    try {
        const runId = resolveProgramRunId(root, options.runId);
        const runDir = programRunDir(root, runId);
        const state = readProgramState(programStatePath(runDir));
        if (!state)
            throw new Error(`missing program state for ${runId}`);
        if (options.json)
            log(JSON.stringify(state, null, 2));
        else
            log(formatProofloopProgramStatus(state, runDir));
        return { state, runDir, ledgerPath: programLedgerPath(runDir), exitCode: 0 };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`proofloop program: ${message}`);
        const fallbackRunId = validId(options.runId) ? options.runId : "unknown";
        const runDir = programRunDir(root, fallbackRunId);
        return { state: emptyProgramErrorState(fallbackRunId, message), runDir, ledgerPath: programLedgerPath(runDir), exitCode: 2 };
    }
}
function programReport(options) {
    const result = programStatus({ ...options, subcommand: "status", log: () => { }, logError: () => { } });
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    if (result.exitCode !== 0) {
        logError(`proofloop program: unable to load report for ${options.runId ?? "latest"}`);
        return result;
    }
    const report = {
        schema: "proofloop-program-report-v1",
        programRunId: result.state.programRunId,
        programId: result.state.programId,
        status: result.state.status,
        authorityDigest: result.state.authorityDigest,
        budgetUsd: result.state.budgetUsd,
        spentEstimatedUsd: result.state.spentEstimatedUsd,
        arcs: result.state.arcStates.map((arc) => ({
            id: arc.id,
            mode: arc.mode,
            status: arc.status,
            attempts: arc.attempts,
            maxAttempts: arc.maxAttempts,
            receiptVerified: arc.receipt?.ok ?? null,
        })),
        statePath: programStatePath(result.runDir),
        ledgerPath: result.ledgerPath,
    };
    if (options.json)
        log(JSON.stringify(report, null, 2));
    else
        log(`${formatProofloopProgramStatus(result.state, result.runDir)}\nreport=${JSON.stringify(report.arcs)}`);
    return result;
}
function emitProgramResult(state, runDir, options, log) {
    if (options.json)
        log(JSON.stringify(state, null, 2));
    else
        log(formatProofloopProgramStatus(state, runDir));
    return { state, runDir, ledgerPath: programLedgerPath(runDir), exitCode: programExitCode(state.status) };
}
function terminalizeProgram(state, runDir, status, event, message, arcId, data) {
    state.status = status;
    state.updatedAt = nowIso();
    writeProgramState(runDir, state);
    appendProgramEvent(runDir, {
        programRunId: state.programRunId,
        event,
        ...(arcId ? { arcId } : {}),
        data: { message, ...(data ?? {}) },
    });
    return state;
}
function writeProgramState(runDir, state) {
    atomicWriteJson(programStatePath(runDir), state);
}
function readProgramState(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        const value = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
        return isRecord(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function appendProgramEvent(runDir, event) {
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    const full = { schema: exports.PROOFLOOP_PROGRAM_EVENT_SCHEMA, at: nowIso(), ...event };
    (0, node_fs_1.appendFileSync)(programLedgerPath(runDir), `${JSON.stringify(full)}\n`, "utf8");
}
function repairProgramLedgerTornTail(runDir) {
    const ledgerPath = programLedgerPath(runDir);
    if (!(0, node_fs_1.existsSync)(ledgerPath))
        return { repaired: false, previousBytes: 0, repairedBytes: 0 };
    const raw = (0, node_fs_1.readFileSync)(ledgerPath, "utf8");
    const previousBytes = Buffer.byteLength(raw);
    if (raw.length === 0 || raw.endsWith("\n"))
        return { repaired: false, previousBytes, repairedBytes: previousBytes };
    const lastNewline = raw.lastIndexOf("\n");
    const repaired = lastNewline >= 0 ? raw.slice(0, lastNewline + 1) : "";
    const repairedBytes = Buffer.byteLength(repaired);
    (0, node_fs_1.truncateSync)(ledgerPath, repairedBytes);
    return { repaired: true, previousBytes, repairedBytes };
}
function acquireProgramLock(runDir, ttlMs, clearStaleLock) {
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    const path = (0, node_path_1.join)(runDir, "program.lock");
    const token = (0, node_crypto_1.randomUUID)();
    try {
        const fd = (0, node_fs_1.openSync)(path, "wx");
        (0, node_fs_1.writeFileSync)(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso() }));
        return programLockHandle(path, fd, token);
    }
    catch (error) {
        const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
        if (code !== "EEXIST")
            throw error;
        const ageMs = programLockAgeMs(path);
        if (ageMs <= ttlMs)
            throw new Error(`program lock is held at ${path}; ageMs=${ageMs}`);
        if (!clearStaleLock)
            throw new Error(`program lock is stale at ${path}; rerun with --clear-stale-lock to recover`);
        (0, node_fs_1.rmSync)(path, { force: true });
        const fd = (0, node_fs_1.openSync)(path, "wx");
        (0, node_fs_1.writeFileSync)(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso(), stoleStaleLock: true }));
        return programLockHandle(path, fd, token);
    }
}
function programLockHandle(path, fd, token) {
    return {
        release: () => {
            try {
                (0, node_fs_1.closeSync)(fd);
            }
            catch {
                // Best effort; the token check below still prevents another process's lock from being removed.
            }
            try {
                const raw = (0, node_fs_1.readFileSync)(path, "utf8");
                const parsed = JSON.parse(raw);
                if (parsed.token === token)
                    (0, node_fs_1.unlinkSync)(path);
            }
            catch {
                // A stale lock can be explicitly recovered by the next operator.
            }
        },
    };
}
function programLockAgeMs(path) {
    try {
        return Math.max(0, Date.now() - (0, node_fs_1.statSync)(path).mtimeMs);
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
}
function writeLatestProgramRun(root, runId) {
    const path = (0, node_path_1.join)(root, PROGRAM_ROOT, "latest");
    atomicWriteText(path, `${runId}\n`);
}
function atomicWriteJson(path, value) {
    atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}
function atomicWriteText(path, text) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    (0, node_fs_1.writeFileSync)(temporary, text, "utf8");
    try {
        (0, node_fs_1.renameSync)(temporary, path);
    }
    catch (error) {
        try {
            if ((0, node_fs_1.existsSync)(path))
                (0, node_fs_1.unlinkSync)(path);
            (0, node_fs_1.renameSync)(temporary, path);
        }
        catch {
            throw error;
        }
    }
}
function emptyProgramErrorState(programRunId, message) {
    const now = nowIso();
    return {
        schema: exports.PROOFLOOP_PROGRAM_STATE_SCHEMA,
        programRunId,
        programId: "unknown",
        planPath: "",
        planDigest: "",
        authorityPath: "",
        authorityDigest: "",
        budgetUsd: 0,
        spentEstimatedUsd: 0,
        status: "failed_integrity",
        createdAt: now,
        updatedAt: now,
        arcStates: [{
                id: "program",
                mode: "read_only",
                dependsOn: [],
                runnerPlanPath: "",
                runnerPlanDigest: "",
                runnerRunId: programRunId,
                estimatedCostUsd: 0,
                maxAttempts: 1,
                attempts: 0,
                status: "failed",
                error: message,
            }],
    };
}
function programExitCode(status) {
    if (status === "certified")
        return 0;
    if (status === "paused" || status === "queued" || status === "running")
        return 4;
    if (status === "blocked_budget")
        return 3;
    if (status === "blocked_authority")
        return 4;
    return 1;
}
function normalizeMaxArcs(value) {
    if (value === undefined)
        return Number.POSITIVE_INFINITY;
    if (!positiveInteger(value))
        throw new Error("program --max-arcs must be a positive integer");
    return value;
}
function defaultProgramRunId(programId) {
    return `${programId}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`;
}
function resolveProgramRepoFile(root, pathInput, label, options = {}) {
    if (typeof pathInput !== "string" || pathInput.length === 0)
        throw new Error(`${label} path is required`);
    if (!options.allowAbsoluteInsideRoot && !safeRepoRelativePath(pathInput))
        throw new Error(`${label} must be a safe repo-relative path`);
    const rootReal = realPathOrResolved(root);
    const candidate = (0, node_path_1.isAbsolute)(pathInput) ? (0, node_path_1.resolve)(pathInput) : (0, node_path_1.resolve)(root, pathInput);
    if (!(0, node_fs_1.existsSync)(candidate))
        throw new Error(`${label} does not exist: ${pathInput}`);
    const candidateReal = realPathOrResolved(candidate);
    const escaped = (0, node_path_1.relative)(rootReal, candidateReal);
    if (escaped === ".." || escaped.startsWith(`..${node_path_1.sep}`) || (0, node_path_1.isAbsolute)(escaped))
        throw new Error(`${label} escapes the repository root`);
    if (!(0, node_fs_1.statSync)(candidateReal).isFile())
        throw new Error(`${label} is not a regular file: ${pathInput}`);
    return candidateReal;
}
function realPathOrResolved(path) {
    try {
        return (0, node_path_1.resolve)((0, node_fs_1.realpathSync)(path));
    }
    catch {
        return (0, node_path_1.resolve)(path);
    }
}
function safeRepoRelativePath(value) {
    if (typeof value !== "string" || value.length === 0 || (0, node_path_1.isAbsolute)(value) || /^[A-Za-z]:/.test(value))
        return false;
    return !value.split(/[\\/]/).includes("..");
}
function parseArcMode(value, label) {
    if (value === "read_only" || value === "proposal_only")
        return value;
    throw new Error(`${label} must be read_only or proposal_only`);
}
function parseIdArray(value, label) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || !value.every(validId))
        throw new Error(`${label} must be an array of IDs`);
    return value;
}
function validId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
}
function nonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function sameStringArray(left, right) {
    return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function isProofloopProgramStatus(value) {
    return value === "queued" || value === "running" || value === "paused" || value === "certified"
        || value === "failed" || value === "failed_integrity" || value === "blocked_budget" || value === "blocked_authority";
}
function isProofloopProgramArcStatus(value) {
    return value === "queued" || value === "running" || value === "passed" || value === "failed"
        || value === "blocked_budget" || value === "blocked_authority";
}
function positiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function requirePositiveInteger(value, label) {
    if (!positiveInteger(value))
        throw new Error(`${label} must be a positive integer`);
    return value;
}
function requireNonNegativeInteger(value, label) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
        throw new Error(`${label} must be a non-negative integer`);
    return value;
}
function nonNegativeFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function rejectUnknownKeys(value, allowed, label) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            throw new Error(`${label} has unknown key \"${key}\"`);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nowIso() {
    return new Date().toISOString();
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
