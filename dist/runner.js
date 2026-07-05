"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProofloopRunner = runProofloopRunner;
exports.readRunnerPlan = readRunnerPlan;
exports.runnerRunDir = runnerRunDir;
exports.runnerStatePath = runnerStatePath;
exports.runnerLedgerPath = runnerLedgerPath;
exports.formatRunnerStatus = formatRunnerStatus;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const RUNNER_ROOT = ".proofloop/runner";
const DEFAULT_BUDGET_USD = 100;
const DEFAULT_LOCK_TTL_MS = 30 * 60_000;
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;
const TASK_OUTPUT_CAPTURE_BYTES = 64 * 1024;
async function runProofloopRunner(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    if (options.subcommand === "status")
        return runnerStatus(options);
    const planPath = resolvePlanPath(root, options);
    const plan = readRunnerPlan(planPath);
    const runId = options.subcommand === "resume" ? resolveRunId(root, options.runId) : options.runId ?? planRunId(planPath, plan);
    const runDir = runnerRunDir(root, runId);
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    let lock;
    try {
        lock = acquireRunnerLock(runDir, options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);
        let state = loadOrCreateState(runDir, {
            runId,
            plan,
            planPath,
            budgetUsd: options.budgetUsd ?? DEFAULT_BUDGET_USD,
        });
        writeLatestRun(root, runId);
        state = requeueStaleRunningTasks(runDir, state);
        const ledgerPath = runnerLedgerPath(runDir);
        appendRunnerEvent(runDir, {
            runId,
            event: "runner_started",
            data: {
                subcommand: options.subcommand,
                budgetUsd: state.budgetUsd,
                maxTasks: options.maxTasks ?? null,
            },
        });
        const byId = new Map(plan.tasks.map((task) => [task.id, task]));
        let executed = 0;
        const maxTasks = options.maxTasks ?? Number.POSITIVE_INFINITY;
        for (const taskState of state.taskStates) {
            if (executed >= maxTasks)
                break;
            if (taskState.status !== "queued")
                continue;
            const task = byId.get(taskState.id);
            if (!task) {
                taskState.status = "failed";
                taskState.error = "Task missing from plan on resume.";
                continue;
            }
            if (roundMoney(state.spentEstimatedUsd + taskState.estimatedCostUsd) > state.budgetUsd) {
                taskState.status = "blocked_budget";
                state.status = "blocked_budget";
                state.updatedAt = nowIso();
                writeRunnerState(runDir, state);
                appendRunnerEvent(runDir, {
                    runId,
                    event: "budget_kill_switch",
                    taskId: task.id,
                    data: {
                        budgetUsd: state.budgetUsd,
                        spentEstimatedUsd: state.spentEstimatedUsd,
                        nextTaskEstimatedCostUsd: taskState.estimatedCostUsd,
                    },
                });
                break;
            }
            state.status = "running";
            taskState.status = "running";
            taskState.attempts += 1;
            taskState.startedAt = nowIso();
            state.updatedAt = taskState.startedAt;
            writeRunnerState(runDir, state);
            appendRunnerEvent(runDir, {
                runId,
                event: "task_started",
                taskId: task.id,
                data: {
                    command: redactText(task.command, mergedEnv(task)),
                    cwd: task.cwd ?? ".",
                    envKeys: Object.keys(task.env ?? {}).sort(),
                    estimatedCostUsd: taskState.estimatedCostUsd,
                },
            });
            if (options.crashAfterStartTaskId === task.id) {
                appendRunnerEvent(runDir, {
                    runId,
                    event: "simulated_crash_after_start",
                    taskId: task.id,
                });
                return { state, runDir, ledgerPath, exitCode: 99 };
            }
            const taskEnv = mergedEnv(task);
            const result = await runTaskCommand(root, task, taskEnv);
            taskState.exitCode = result.status;
            taskState.signal = result.signal;
            taskState.completedAt = nowIso();
            taskState.status = result.status === 0 ? "passed" : "failed";
            if (result.error)
                taskState.error = redactText(result.error.message, taskEnv);
            if (taskState.status === "passed")
                state.spentEstimatedUsd = roundMoney(state.spentEstimatedUsd + taskState.estimatedCostUsd);
            state.updatedAt = taskState.completedAt;
            appendRunnerEvent(runDir, {
                runId,
                event: "task_completed",
                taskId: task.id,
                data: {
                    status: taskState.status,
                    exitCode: taskState.exitCode,
                    signal: taskState.signal,
                    stdout: redactText((result.stdout ?? "").slice(-2000), taskEnv),
                    stderr: redactText((result.stderr ?? "").slice(-2000), taskEnv),
                    error: taskState.error,
                },
            });
            writeRunnerState(runDir, state);
            executed += 1;
            if (taskState.status === "failed")
                break;
        }
        state.status = finalRunnerStatus(state, executed, maxTasks);
        state.updatedAt = nowIso();
        writeRunnerState(runDir, state);
        appendRunnerEvent(runDir, {
            runId,
            event: "runner_finished",
            data: {
                status: state.status,
                spentEstimatedUsd: state.spentEstimatedUsd,
            },
        });
        if (options.json)
            log(JSON.stringify(state, null, 2));
        else
            log(formatRunnerStatus(state, runDir));
        return { state, runDir, ledgerPath, exitCode: state.status === "passed" || state.status === "paused" ? 0 : 1 };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`proofloop runner: ${message}`);
        const runDirFallback = runnerRunDir(root, options.runId ?? "unknown");
        return {
            state: emptyErrorState(options.runId ?? "unknown", options.budgetUsd ?? DEFAULT_BUDGET_USD, message),
            runDir: runDirFallback,
            ledgerPath: runnerLedgerPath(runDirFallback),
            exitCode: 2,
        };
    }
    finally {
        lock?.release();
    }
}
function readRunnerPlan(planPath) {
    const parsed = JSON.parse((0, node_fs_1.readFileSync)(planPath, "utf8").replace(/^\uFEFF/, ""));
    if (parsed.schema !== "proofloop-runner-plan-v1")
        throw new Error("runner plan schema must be proofloop-runner-plan-v1");
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0)
        throw new Error("runner plan must include tasks");
    const ids = new Set();
    const tasks = parsed.tasks.map((task) => {
        if (!task || typeof task.id !== "string" || !task.id.trim())
            throw new Error("runner task id is required");
        if (ids.has(task.id))
            throw new Error(`duplicate runner task id: ${task.id}`);
        ids.add(task.id);
        if (typeof task.command !== "string" || !task.command.trim())
            throw new Error(`runner task ${task.id} command is required`);
        return {
            ...task,
            estimatedCostUsd: typeof task.estimatedCostUsd === "number" && Number.isFinite(task.estimatedCostUsd) ? task.estimatedCostUsd : 0,
        };
    });
    return { schema: "proofloop-runner-plan-v1", tasks };
}
function runTaskCommand(root, task, env) {
    return new Promise((resolveResult) => {
        let stdout = "";
        let stderr = "";
        let completed = false;
        let timedOut = false;
        const child = (0, node_child_process_1.spawn)(task.command, {
            cwd: resolveTaskCwd(root, task),
            env,
            shell: true,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const cleanupSignals = installRunnerSignalHandlers(child.pid);
        const timeoutMs = task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            terminateProcessTree(child.pid);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => {
            stdout = appendCapturedOutput(stdout, chunk);
        });
        child.stderr?.on("data", (chunk) => {
            stderr = appendCapturedOutput(stderr, chunk);
        });
        const finish = (status, signal, error) => {
            if (completed)
                return;
            completed = true;
            clearTimeout(timer);
            cleanupSignals();
            resolveResult({
                status,
                signal,
                stdout,
                stderr,
                ...(error ? { error } : {}),
            });
        };
        child.once("error", (error) => finish(null, null, error));
        child.once("exit", (status, signal) => {
            finish(status, signal, timedOut ? new Error(`task timed out after ${timeoutMs}ms`) : undefined);
        });
    });
}
function appendCapturedOutput(current, chunk) {
    const next = current + chunk.toString();
    return next.length > TASK_OUTPUT_CAPTURE_BYTES ? next.slice(-TASK_OUTPUT_CAPTURE_BYTES) : next;
}
function installRunnerSignalHandlers(childPid) {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const installed = [];
    for (const signal of signals) {
        const handler = () => {
            terminateProcessTree(childPid);
            process.exit(signalExitCode(signal));
        };
        process.once(signal, handler);
        installed.push([signal, handler]);
    }
    return () => {
        for (const [signal, handler] of installed)
            process.off(signal, handler);
    };
}
function signalExitCode(signal) {
    switch (signal) {
        case "SIGINT":
            return 130;
        case "SIGTERM":
            return 143;
        default:
            return 129;
    }
}
function terminateProcessTree(pid) {
    if (!pid)
        return;
    if (process.platform === "win32") {
        (0, node_child_process_1.spawnSync)("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        return;
    }
    try {
        process.kill(-pid, "SIGTERM");
    }
    catch {
        try {
            process.kill(pid, "SIGTERM");
        }
        catch {
            // The child may already be gone; resume will rely on durable state.
        }
    }
}
function runnerRunDir(root, runId) {
    return (0, node_path_1.join)(root, RUNNER_ROOT, "runs", runId);
}
function runnerStatePath(runDir) {
    return (0, node_path_1.join)(runDir, "state.json");
}
function runnerLedgerPath(runDir) {
    return (0, node_path_1.join)(runDir, "ledger.jsonl");
}
function formatRunnerStatus(state, runDir) {
    const counts = statusCounts(state);
    return [
        `proofloop runner: ${state.runId}`,
        `status=${state.status} budget=$${state.budgetUsd.toFixed(4)} spent_est=$${state.spentEstimatedUsd.toFixed(4)}`,
        `tasks passed=${counts.passed} queued=${counts.queued} running=${counts.running} failed=${counts.failed} blocked_budget=${counts.blocked_budget}`,
        `state=${runnerStatePath(runDir)}`,
        `ledger=${runnerLedgerPath(runDir)}`,
    ].join("\n");
}
function runnerStatus(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    try {
        const runId = resolveRunId(root, options.runId);
        const runDir = runnerRunDir(root, runId);
        const state = readJson(runnerStatePath(runDir));
        if (!state)
            throw new Error(`missing runner state for ${runId}`);
        if (options.json)
            log(JSON.stringify(state, null, 2));
        else
            log(formatRunnerStatus(state, runDir));
        return { state, runDir, ledgerPath: runnerLedgerPath(runDir), exitCode: 0 };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`proofloop runner: ${message}`);
        return {
            state: emptyErrorState(options.runId ?? "latest", options.budgetUsd ?? DEFAULT_BUDGET_USD, message),
            runDir: runnerRunDir(root, options.runId ?? "latest"),
            ledgerPath: runnerLedgerPath(runnerRunDir(root, options.runId ?? "latest")),
            exitCode: 2,
        };
    }
}
function resolvePlanPath(root, options) {
    if (options.subcommand === "resume") {
        const runId = resolveRunId(root, options.runId);
        const state = readJson(runnerStatePath(runnerRunDir(root, runId)));
        if (!state)
            throw new Error(`cannot resume: missing state for ${runId}`);
        return state.planPath;
    }
    if (!options.planPath)
        throw new Error("runner run requires --plan <file>");
    return (0, node_path_1.isAbsolute)(options.planPath) ? options.planPath : (0, node_path_1.resolve)(root, options.planPath);
}
function resolveRunId(root, runId) {
    if (runId && runId !== "latest")
        return runId;
    const latestPath = (0, node_path_1.join)(root, RUNNER_ROOT, "latest");
    if (!(0, node_fs_1.existsSync)(latestPath))
        throw new Error("no latest runner run exists");
    return (0, node_fs_1.readFileSync)(latestPath, "utf8").trim();
}
function loadOrCreateState(runDir, args) {
    const existing = readJson(runnerStatePath(runDir));
    const planDigest = digestPlan(args.plan);
    if (existing) {
        if (existing.planDigest !== planDigest)
            throw new Error("runner plan changed for existing run; use a new --run-id");
        if (args.budgetUsd !== existing.budgetUsd) {
            existing.budgetUsd = args.budgetUsd;
            existing.updatedAt = nowIso();
            writeRunnerState(runDir, existing);
        }
        return existing;
    }
    const state = {
        schema: "proofloop-runner-state-v1",
        runId: args.runId,
        planPath: args.planPath,
        planDigest,
        budgetUsd: args.budgetUsd,
        spentEstimatedUsd: 0,
        status: "queued",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        taskStates: args.plan.tasks.map((task) => ({
            id: task.id,
            status: "queued",
            attempts: 0,
            estimatedCostUsd: task.estimatedCostUsd ?? 0,
        })),
    };
    writeRunnerState(runDir, state);
    return state;
}
function requeueStaleRunningTasks(runDir, state) {
    let changed = false;
    for (const task of state.taskStates) {
        if (task.status !== "running")
            continue;
        appendRunnerEvent(runDir, {
            runId: state.runId,
            event: "stale_running_requeued",
            taskId: task.id,
            data: { previousStartedAt: task.startedAt ?? null },
        });
        task.status = "queued";
        task.error = "Requeued after interrupted runner process.";
        changed = true;
    }
    if (changed) {
        state.status = "queued";
        state.updatedAt = nowIso();
        writeRunnerState(runDir, state);
    }
    return state;
}
function finalRunnerStatus(state, executed, maxTasks) {
    if (state.taskStates.some((task) => task.status === "failed"))
        return "failed";
    if (state.taskStates.some((task) => task.status === "blocked_budget"))
        return "blocked_budget";
    if (state.taskStates.every((task) => task.status === "passed"))
        return "passed";
    if (executed >= maxTasks)
        return "paused";
    return "queued";
}
function writeRunnerState(runDir, state) {
    atomicWriteJson(runnerStatePath(runDir), state);
}
function appendRunnerEvent(runDir, event) {
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    const full = { schema: "proofloop-runner-event-v1", at: nowIso(), ...event };
    (0, node_fs_1.appendFileSync)(runnerLedgerPath(runDir), `${JSON.stringify(full)}\n`, "utf8");
}
function acquireRunnerLock(runDir, ttlMs) {
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    const lockPath = (0, node_path_1.join)(runDir, "run.lock");
    const token = (0, node_crypto_1.randomUUID)();
    try {
        const fd = (0, node_fs_1.openSync)(lockPath, "wx");
        (0, node_fs_1.writeFileSync)(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso() }));
        return lockHandle(lockPath, fd, token);
    }
    catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code !== "EEXIST")
            throw error;
        const staleReason = staleLockReason(lockPath, ttlMs);
        if (staleReason) {
            (0, node_fs_1.rmSync)(lockPath, { force: true });
            const fd = (0, node_fs_1.openSync)(lockPath, "wx");
            (0, node_fs_1.writeFileSync)(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso(), stoleStaleLockReason: staleReason }));
            return lockHandle(lockPath, fd, token);
        }
        throw new Error(`runner lock is held at ${lockPath}; ageMs=${lockAgeMs(lockPath)}`);
    }
}
function staleLockReason(lockPath, ttlMs) {
    const age = lockAgeMs(lockPath);
    if (age >= ttlMs)
        return `ttl_expired:${Math.trunc(age)}ms`;
    const pid = lockPid(lockPath);
    if (pid !== undefined && !pidIsAlive(pid))
        return `pid_dead:${pid}`;
    return undefined;
}
function lockPid(lockPath) {
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(lockPath, "utf8"));
        return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : undefined;
    }
    catch {
        return undefined;
    }
}
function pidIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function lockHandle(lockPath, fd, token) {
    return {
        lockPath,
        fd,
        token,
        release: () => {
            try {
                (0, node_fs_1.closeSync)(fd);
            }
            catch {
                // ignore close errors during process shutdown
            }
            try {
                const raw = (0, node_fs_1.existsSync)(lockPath) ? (0, node_fs_1.readFileSync)(lockPath, "utf8") : "";
                if (raw.includes(token))
                    (0, node_fs_1.unlinkSync)(lockPath);
            }
            catch {
                // leave lock for TTL recovery
            }
        },
    };
}
function lockAgeMs(lockPath) {
    try {
        return Date.now() - (0, node_fs_1.statSync)(lockPath).mtimeMs;
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
}
function writeLatestRun(root, runId) {
    const latestPath = (0, node_path_1.join)(root, RUNNER_ROOT, "latest");
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(latestPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(latestPath, `${runId}\n`, "utf8");
}
function resolveTaskCwd(root, task) {
    if (!task.cwd)
        return root;
    return (0, node_path_1.isAbsolute)(task.cwd) ? task.cwd : (0, node_path_1.resolve)(root, task.cwd);
}
function mergedEnv(task) {
    return { ...process.env, ...(task.env ?? {}) };
}
function digestPlan(plan) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(plan)).digest("hex");
}
function planRunId(planPath, plan) {
    const slug = planPath.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.json$/i, "") || "plan";
    return `${slug}-${digestPlan(plan).slice(0, 10)}`;
}
function atomicWriteJson(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    (0, node_fs_1.writeFileSync)(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    (0, node_fs_1.renameSync)(temp, path);
}
function readJson(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
    }
    catch {
        return undefined;
    }
}
function emptyErrorState(runId, budgetUsd, message) {
    return {
        schema: "proofloop-runner-state-v1",
        runId,
        planPath: "",
        planDigest: "",
        budgetUsd,
        spentEstimatedUsd: 0,
        status: "failed",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        taskStates: [{ id: "runner", status: "failed", attempts: 0, estimatedCostUsd: 0, error: message }],
    };
}
function statusCounts(state) {
    const counts = {
        queued: 0,
        running: 0,
        passed: 0,
        failed: 0,
        blocked_budget: 0,
    };
    for (const task of state.taskStates)
        counts[task.status] += 1;
    return counts;
}
function redactText(value, env) {
    let out = value;
    for (const [key, raw] of Object.entries(env)) {
        if (!raw || raw.length < 4)
            continue;
        if (!/(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE)/i.test(key))
            continue;
        out = out.split(raw).join(`[redacted:${key}]`);
    }
    return out;
}
function nowIso() {
    return new Date().toISOString();
}
function roundMoney(value) {
    return Number(value.toFixed(6));
}
