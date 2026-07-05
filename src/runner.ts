import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
  subcommand: "run" | "resume" | "status";
  planPath?: string;
  runId?: string;
  budgetUsd?: number;
  maxTasks?: number;
  lockTtlMs?: number;
  json?: boolean;
  crashAfterStartTaskId?: string;
  log?: (message: string) => void;
  logError?: (message: string) => void;
};

type TaskRunResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

type LockHandle = {
  lockPath: string;
  fd: number;
  token: string;
  release: () => void;
};

const RUNNER_ROOT = ".proofloop/runner";
const DEFAULT_BUDGET_USD = 100;
const DEFAULT_LOCK_TTL_MS = 30 * 60_000;
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;
const TASK_OUTPUT_CAPTURE_BYTES = 64 * 1024;

export async function runProofloopRunner(options: ProofloopRunnerOptions): Promise<ProofloopRunnerResult> {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  if (options.subcommand === "status") return runnerStatus(options);

  const planPath = resolvePlanPath(root, options);
  const plan = readRunnerPlan(planPath);
  const runId = options.subcommand === "resume" ? resolveRunId(root, options.runId) : options.runId ?? planRunId(planPath, plan);
  const runDir = runnerRunDir(root, runId);
  mkdirSync(runDir, { recursive: true });

  let lock: LockHandle | undefined;
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
      if (executed >= maxTasks) break;
      if (taskState.status !== "queued") continue;
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
      if (result.error) taskState.error = redactText(result.error.message, taskEnv);
      if (taskState.status === "passed") state.spentEstimatedUsd = roundMoney(state.spentEstimatedUsd + taskState.estimatedCostUsd);
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
      if (taskState.status === "failed") break;
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
    if (options.json) log(JSON.stringify(state, null, 2));
    else log(formatRunnerStatus(state, runDir));
    return { state, runDir, ledgerPath, exitCode: state.status === "passed" || state.status === "paused" ? 0 : 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`proofloop runner: ${message}`);
    const runDirFallback = runnerRunDir(root, options.runId ?? "unknown");
    return {
      state: emptyErrorState(options.runId ?? "unknown", options.budgetUsd ?? DEFAULT_BUDGET_USD, message),
      runDir: runDirFallback,
      ledgerPath: runnerLedgerPath(runDirFallback),
      exitCode: 2,
    };
  } finally {
    lock?.release();
  }
}

export function readRunnerPlan(planPath: string): ProofloopRunnerPlan {
  const parsed = JSON.parse(readFileSync(planPath, "utf8").replace(/^\uFEFF/, "")) as Partial<ProofloopRunnerPlan>;
  if (parsed.schema !== "proofloop-runner-plan-v1") throw new Error("runner plan schema must be proofloop-runner-plan-v1");
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) throw new Error("runner plan must include tasks");
  const ids = new Set<string>();
  const tasks = parsed.tasks.map((task) => {
    if (!task || typeof task.id !== "string" || !task.id.trim()) throw new Error("runner task id is required");
    if (ids.has(task.id)) throw new Error(`duplicate runner task id: ${task.id}`);
    ids.add(task.id);
    if (typeof task.command !== "string" || !task.command.trim()) throw new Error(`runner task ${task.id} command is required`);
    return {
      ...task,
      estimatedCostUsd: typeof task.estimatedCostUsd === "number" && Number.isFinite(task.estimatedCostUsd) ? task.estimatedCostUsd : 0,
    };
  });
  return { schema: "proofloop-runner-plan-v1", tasks };
}

function runTaskCommand(root: string, task: ProofloopRunnerTaskPlan, env: NodeJS.ProcessEnv): Promise<TaskRunResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let completed = false;
    let timedOut = false;

    const child = spawn(task.command, {
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

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendCapturedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendCapturedOutput(stderr, chunk);
    });

    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
      if (completed) return;
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

function appendCapturedOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > TASK_OUTPUT_CAPTURE_BYTES ? next.slice(-TASK_OUTPUT_CAPTURE_BYTES) : next;
}

function installRunnerSignalHandlers(childPid: number | undefined): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const installed: Array<[NodeJS.Signals, NodeJS.SignalsListener]> = [];
  for (const signal of signals) {
    const handler: NodeJS.SignalsListener = () => {
      terminateProcessTree(childPid);
      process.exit(signalExitCode(signal));
    };
    process.once(signal, handler);
    installed.push([signal, handler]);
  }
  return () => {
    for (const [signal, handler] of installed) process.off(signal, handler);
  };
}

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 129;
  }
}

function terminateProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The child may already be gone; resume will rely on durable state.
    }
  }
}

export function runnerRunDir(root: string, runId: string): string {
  return join(root, RUNNER_ROOT, "runs", runId);
}

export function runnerStatePath(runDir: string): string {
  return join(runDir, "state.json");
}

export function runnerLedgerPath(runDir: string): string {
  return join(runDir, "ledger.jsonl");
}

export function formatRunnerStatus(state: ProofloopRunnerState, runDir: string): string {
  const counts = statusCounts(state);
  return [
    `proofloop runner: ${state.runId}`,
    `status=${state.status} budget=$${state.budgetUsd.toFixed(4)} spent_est=$${state.spentEstimatedUsd.toFixed(4)}`,
    `tasks passed=${counts.passed} queued=${counts.queued} running=${counts.running} failed=${counts.failed} blocked_budget=${counts.blocked_budget}`,
    `state=${runnerStatePath(runDir)}`,
    `ledger=${runnerLedgerPath(runDir)}`,
  ].join("\n");
}

function runnerStatus(options: ProofloopRunnerOptions): ProofloopRunnerResult {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  try {
    const runId = resolveRunId(root, options.runId);
    const runDir = runnerRunDir(root, runId);
    const state = readJson<ProofloopRunnerState>(runnerStatePath(runDir));
    if (!state) throw new Error(`missing runner state for ${runId}`);
    if (options.json) log(JSON.stringify(state, null, 2));
    else log(formatRunnerStatus(state, runDir));
    return { state, runDir, ledgerPath: runnerLedgerPath(runDir), exitCode: 0 };
  } catch (error) {
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

function resolvePlanPath(root: string, options: ProofloopRunnerOptions): string {
  if (options.subcommand === "resume") {
    const runId = resolveRunId(root, options.runId);
    const state = readJson<ProofloopRunnerState>(runnerStatePath(runnerRunDir(root, runId)));
    if (!state) throw new Error(`cannot resume: missing state for ${runId}`);
    return state.planPath;
  }
  if (!options.planPath) throw new Error("runner run requires --plan <file>");
  return isAbsolute(options.planPath) ? options.planPath : resolve(root, options.planPath);
}

function resolveRunId(root: string, runId: string | undefined): string {
  if (runId && runId !== "latest") return runId;
  const latestPath = join(root, RUNNER_ROOT, "latest");
  if (!existsSync(latestPath)) throw new Error("no latest runner run exists");
  return readFileSync(latestPath, "utf8").trim();
}

function loadOrCreateState(
  runDir: string,
  args: { runId: string; plan: ProofloopRunnerPlan; planPath: string; budgetUsd: number },
): ProofloopRunnerState {
  const existing = readJson<ProofloopRunnerState>(runnerStatePath(runDir));
  const planDigest = digestPlan(args.plan);
  if (existing) {
    if (existing.planDigest !== planDigest) throw new Error("runner plan changed for existing run; use a new --run-id");
    if (args.budgetUsd !== existing.budgetUsd) {
      existing.budgetUsd = args.budgetUsd;
      existing.updatedAt = nowIso();
      writeRunnerState(runDir, existing);
    }
    return existing;
  }
  const state: ProofloopRunnerState = {
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

function requeueStaleRunningTasks(runDir: string, state: ProofloopRunnerState): ProofloopRunnerState {
  let changed = false;
  for (const task of state.taskStates) {
    if (task.status !== "running") continue;
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

function finalRunnerStatus(state: ProofloopRunnerState, executed: number, maxTasks: number): ProofloopRunnerStatus {
  if (state.taskStates.some((task) => task.status === "failed")) return "failed";
  if (state.taskStates.some((task) => task.status === "blocked_budget")) return "blocked_budget";
  if (state.taskStates.every((task) => task.status === "passed")) return "passed";
  if (executed >= maxTasks) return "paused";
  return "queued";
}

function writeRunnerState(runDir: string, state: ProofloopRunnerState): void {
  atomicWriteJson(runnerStatePath(runDir), state);
}

function appendRunnerEvent(runDir: string, event: Omit<ProofloopRunnerEvent, "schema" | "at">): void {
  mkdirSync(runDir, { recursive: true });
  const full: ProofloopRunnerEvent = { schema: "proofloop-runner-event-v1", at: nowIso(), ...event };
  appendFileSync(runnerLedgerPath(runDir), `${JSON.stringify(full)}\n`, "utf8");
}

function acquireRunnerLock(runDir: string, ttlMs: number): LockHandle {
  mkdirSync(runDir, { recursive: true });
  const lockPath = join(runDir, "run.lock");
  const token = randomUUID();
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso() }));
    return lockHandle(lockPath, fd, token);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "EEXIST") throw error;
    const staleReason = staleLockReason(lockPath, ttlMs);
    if (staleReason) {
      rmSync(lockPath, { force: true });
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: nowIso(), stoleStaleLockReason: staleReason }));
      return lockHandle(lockPath, fd, token);
    }
    throw new Error(`runner lock is held at ${lockPath}; ageMs=${lockAgeMs(lockPath)}`);
  }
}

function staleLockReason(lockPath: string, ttlMs: number): string | undefined {
  const age = lockAgeMs(lockPath);
  if (age >= ttlMs) return `ttl_expired:${Math.trunc(age)}ms`;
  const pid = lockPid(lockPath);
  if (pid !== undefined && !pidIsAlive(pid)) return `pid_dead:${pid}`;
  return undefined;
}

function lockPid(lockPath: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockHandle(lockPath: string, fd: number, token: string): LockHandle {
  return {
    lockPath,
    fd,
    token,
    release: () => {
      try {
        closeSync(fd);
      } catch {
        // ignore close errors during process shutdown
      }
      try {
        const raw = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : "";
        if (raw.includes(token)) unlinkSync(lockPath);
      } catch {
        // leave lock for TTL recovery
      }
    },
  };
}

function lockAgeMs(lockPath: string): number {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function writeLatestRun(root: string, runId: string): void {
  const latestPath = join(root, RUNNER_ROOT, "latest");
  mkdirSync(dirname(latestPath), { recursive: true });
  writeFileSync(latestPath, `${runId}\n`, "utf8");
}

function resolveTaskCwd(root: string, task: ProofloopRunnerTaskPlan): string {
  if (!task.cwd) return root;
  return isAbsolute(task.cwd) ? task.cwd : resolve(root, task.cwd);
}

function mergedEnv(task: ProofloopRunnerTaskPlan): NodeJS.ProcessEnv {
  return { ...process.env, ...(task.env ?? {}) };
}

function digestPlan(plan: ProofloopRunnerPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function planRunId(planPath: string, plan: ProofloopRunnerPlan): string {
  const slug = planPath.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.json$/i, "") || "plan";
  return `${slug}-${digestPlan(plan).slice(0, 10)}`;
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function emptyErrorState(runId: string, budgetUsd: number, message: string): ProofloopRunnerState {
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

function statusCounts(state: ProofloopRunnerState): Record<ProofloopRunnerTaskStatus, number> {
  const counts: Record<ProofloopRunnerTaskStatus, number> = {
    queued: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked_budget: 0,
  };
  for (const task of state.taskStates) counts[task.status] += 1;
  return counts;
}

function redactText(value: string, env: NodeJS.ProcessEnv): string {
  let out = value;
  for (const [key, raw] of Object.entries(env)) {
    if (!raw || raw.length < 4) continue;
    if (!/(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE)/i.test(key)) continue;
    out = out.split(raw).join(`[redacted:${key}]`);
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}
