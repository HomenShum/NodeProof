/**
 * One small adapter per coding agent -- Codex, Claude Code, Cursor, Windsurf,
 * Devin, and a generic CLI -- so the rest of the codebase can say "install your
 * hooks" and "here is a repair prompt, go fix it" without knowing which agent is
 * on the other side.
 *
 * An adapter is deliberately thin: where its settings file lives, and how to
 * launch it with a prompt file. Launching is spawn-based and reports
 * `needs_command` rather than guessing when the agent is not installed --
 * silently doing nothing would look identical to a passing run.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { installProofloopHooks, type ProofloopHookWorker } from "./proofloopHooks";
import { repairTimeoutMs } from "./repairDeadline";

export const PROOFLOOP_AGENT_ADAPTER_IDS = ["codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"] as const;

export type ProofloopAgentAdapterId = (typeof PROOFLOOP_AGENT_ADAPTER_IDS)[number];
export type ProofloopAgentAdapterStatus = "ready" | "needs_adapter" | "needs_command" | "failed";

export type HookInstallResult = {
  schema: "proofloop-agent-adapter-setup-v1";
  generatedAt: string;
  adapterId: ProofloopAgentAdapterId;
  status: ProofloopAgentAdapterStatus;
  hookHost?: ProofloopHookWorker;
  settingsPath?: string;
  message: string;
  launchCommand?: string;
  traceCapture: string[];
  gateEnforcement: string[];
  nextCommands: string[];
  receiptPath: string;
};

export type AgentRunResult = {
  adapterId: ProofloopAgentAdapterId;
  status: "launched" | "needs_adapter" | "needs_command" | "failed";
  launched: boolean;
  command?: string;
  promptPath: string;
  exitCode?: number;
  stdoutPath?: string;
  stderrPath?: string;
  message: string;
};

export type AgentTrace = {
  schema: "proofloop-agent-trace-v1";
  adapterId: ProofloopAgentAdapterId;
  runDir: string;
  evidenceFiles: string[];
};

export type ProofloopVerdict = {
  runId: string;
  suite: string;
  cmd: string;
  passed: boolean;
  exitCode: number;
  score?: number;
  minScore?: number;
  failedGates?: string[];
  receiptPaths: string[];
};

export type ProofloopAgentAdapter = {
  id: ProofloopAgentAdapterId;
  installHooks(targetDir: string, options?: { local?: boolean; command?: string }): Promise<HookInstallResult>;
  launch(promptPath: string, targetDir: string, options?: { command?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal }): Promise<AgentRunResult>;
  collectTrace(runDir: string): Promise<AgentTrace>;
  buildRepairPrompt(verdict: ProofloopVerdict, options?: { repairPrompt?: string; attempt?: number; maxAttempts?: number }): Promise<string>;
};

export function parseProofloopAgentAdapterId(value: string): ProofloopAgentAdapterId {
  if ((PROOFLOOP_AGENT_ADAPTER_IDS as readonly string[]).includes(value)) return value as ProofloopAgentAdapterId;
  throw new Error(`Unknown agent adapter ${value}. Expected one of: ${PROOFLOOP_AGENT_ADAPTER_IDS.join(", ")}`);
}

export function getProofloopAgentAdapter(id: ProofloopAgentAdapterId): ProofloopAgentAdapter {
  return {
    id,
    installHooks: (targetDir, options) => setupProofloopAgentAdapter({ adapterId: id, root: targetDir, ...options }),
    launch: (promptPath, targetDir, options) => launchProofloopAgentAdapter({ adapterId: id, promptPath, targetDir, ...options }),
    collectTrace: (runDir) => Promise.resolve(collectProofloopAgentTrace({ adapterId: id, runDir })),
    buildRepairPrompt: (verdict, options) => Promise.resolve(buildAgentRepairPrompt({ adapterId: id, verdict, ...options })),
  };
}

export async function setupProofloopAgentAdapter(args: {
  adapterId: ProofloopAgentAdapterId;
  root?: string;
  local?: boolean;
  command?: string;
  generatedAt?: string;
}): Promise<HookInstallResult> {
  const root = resolve(args.root ?? process.cwd());
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const hookHost = hookWorkerForAgent(args.adapterId);
  const command = args.command ?? defaultLaunchCommand(args.adapterId, process.env);
  let status: ProofloopAgentAdapterStatus = hookHost || command ? "ready" : "needs_adapter";
  let settingsPath: string | undefined;
  let message = adapterSetupMessage(args.adapterId, status);

  if (hookHost) {
    const installed = installProofloopHooks({ root, worker: hookHost, local: args.local ?? true });
    settingsPath = rel(root, installed.settingsPath);
    message = `${args.adapterId} hooks installed via ${hookHost}.`;
  } else if (args.adapterId === "generic-cli" && !command) {
    status = "needs_command";
    message = "generic-cli requires --command or PROOFLOOP_GENERIC_AGENT_COMMAND.";
  }

  const receipt: HookInstallResult = {
    schema: "proofloop-agent-adapter-setup-v1",
    generatedAt,
    adapterId: args.adapterId,
    status,
    ...(hookHost ? { hookHost } : {}),
    ...(settingsPath ? { settingsPath } : {}),
    message,
    ...(command ? { launchCommand: command } : {}),
    traceCapture: traceCaptureForAgent(args.adapterId),
    gateEnforcement: gateEnforcementForAgent(args.adapterId, hookHost),
    nextCommands: nextCommandsForAgent(args.adapterId, status),
    receiptPath: rel(root, agentSetupReceiptPath(root, args.adapterId)),
  };
  writeJson(agentSetupReceiptPath(root, args.adapterId), receipt);
  return receipt;
}

export async function launchProofloopAgentAdapter(args: {
  adapterId: ProofloopAgentAdapterId;
  promptPath: string;
  targetDir?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AgentRunResult> {
  const timeoutMs = repairTimeoutMs(args.timeoutMs);
  const targetDir = resolve(args.targetDir ?? process.cwd());
  const env = args.env ?? process.env;
  const failedBeforeLaunch = (message: string): AgentRunResult => ({
    adapterId: args.adapterId, status: "failed", launched: false,
    promptPath: rel(targetDir, args.promptPath), message,
  });
  if (args.signal?.aborted) return failedBeforeLaunch("Repair cancelled before launch.");
  const command = args.command ?? defaultLaunchCommand(args.adapterId, env);
  if (!command) {
    const status = args.adapterId === "generic-cli" ? "needs_command" : "needs_adapter";
    return {
      adapterId: args.adapterId,
      status,
      launched: false,
      promptPath: rel(targetDir, args.promptPath),
      message: `${args.adapterId} has no launch command configured.`,
    };
  }

  let prompt: string;
  try { prompt = readFileSync(args.promptPath, "utf8"); }
  catch (error) { return failedBeforeLaunch(`Cannot read repair prompt: ${errorMessage(error)}`); }
  const result = await runRepairProcess(command, targetDir, prompt, {
    ...env, PROOFLOOP_AGENT_ADAPTER: args.adapterId, PROOFLOOP_REPAIR_PROMPT: args.promptPath,
  }, timeoutMs, args.signal);
  const stdoutPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stdout.log`);
  const stderrPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stderr.log`);
  let failure = result.failure;
  const persisted: { stdoutPath?: string; stderrPath?: string } = {};
  for (const [key, path, contents] of [["stdoutPath", stdoutPath, result.stdout], ["stderrPath", stderrPath, result.stderr]] as const) {
    try { writeFileSync(path, contents); persisted[key] = rel(targetDir, path); }
    catch (error) { failure = `${failure ? `${failure}; ` : ""}Cannot persist ${key}: ${errorMessage(error)}`; }
  }
  const exitCode = failure ? result.code || 1 : result.code ?? 1;
  return {
    adapterId: args.adapterId,
    status: !failure && exitCode === 0 ? "launched" : "failed",
    launched: result.launched,
    command,
    promptPath: rel(targetDir, args.promptPath),
    exitCode,
    ...persisted,
    message: failure ?? (exitCode === 0 ? `${args.adapterId} completed; rerun the Proof Loop gate.` : `${args.adapterId} exited ${exitCode}.`),
  };
}

const REPAIR_OUTPUT_BYTES = 1024 * 1024;
const CLEANUP_BUDGET_MS = process.platform === "win32" ? 4000 : 2000;

type RepairProcessResult = { launched: boolean; code: number | null; stdout: Buffer; stderr: Buffer; failure?: string };

function runRepairProcess(command: string, cwd: string, prompt: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal): Promise<RepairProcessResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, { cwd, env, shell: true, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({ launched: false, code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), failure: `Repair launch failed: ${errorMessage(error)}` });
      return;
    }
    let launched = false, closed = false, exited = false, settled = false;
    let code: number | null = null, failure: string | undefined;
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const bytes = { stdout: 0, stderr: 0 };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      child.unref();
      resolveResult({ launched, code, stdout: Buffer.concat(output.stdout), stderr: Buffer.concat(output.stderr), ...(failure ? { failure } : {}) });
    };
    const fail = (reason: string) => {
      if (settled || failure) return;
      failure = reason;
      clearTimeout(deadline);
      if (!child.pid) { finish(); return; }
      // A root which already exited cannot identify a remaining Windows process tree safely.
      void terminateOwnedRepair(child.pid, () => closed, exited).then(confirmed => {
        if (!confirmed) failure += "; cleanup-unverified: owned process tree or output closure could not be confirmed; stop automation.";
        finish();
      }, error => {
        failure += `; cleanup-unverified: ${errorMessage(error)}; stop automation.`;
        finish();
      });
    };
    const abort = () => fail("Repair cancelled by caller.");
    const deadline = setTimeout(() => fail(`Repair timed out after ${timeoutMs}ms.`), timeoutMs);
    child.once("spawn", () => { launched = true; });
    child.once("error", error => fail(`Repair launch failed: ${errorMessage(error)}`));
    child.once("exit", status => { exited = true; code = status; });
    child.once("close", status => { closed = true; code = status; if (!failure) finish(); });
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].on("data", (chunk: Buffer) => {
        if (settled) return;
        const remaining = REPAIR_OUTPUT_BYTES - bytes[stream];
        if (remaining > 0) { const captured = Buffer.from(chunk.subarray(0, remaining)); output[stream].push(captured); bytes[stream] += captured.length; }
        if (chunk.length > remaining) fail(`Repair ${stream} exceeded ${REPAIR_OUTPUT_BYTES} bytes.`);
      });
      child[stream].on("error", error => fail(`Repair ${stream} failed: ${errorMessage(error)}`));
    }
    child.stdin.on("error", error => fail(`Repair stdin failed: ${errorMessage(error)}`));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else child.stdin.end(prompt);
  });
}

async function terminateOwnedRepair(pid: number, closed: () => boolean, rootAlreadyExited: boolean): Promise<boolean> {
  const until = Date.now() + CLEANUP_BUDGET_MS;
  if (process.platform === "win32") {
    if (rootAlreadyExited) return false;
    const killed = await new Promise<boolean>(resolveKill => {
      const killer = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; clearTimeout(timer); resolveKill(ok); } };
      const timer = setTimeout(() => {
        try { killer.kill(); } catch { /* Helper termination is unverified too. */ }
        killer.unref(); finish(false);
      }, 3000);
      killer.once("error", () => finish(false));
      killer.once("close", status => finish(status === 0));
    });
    while (killed && !closed() && Date.now() < until) await pause(25);
    // A helper exit alone is insufficient: require the owned shell's drained close too.
    return killed && closed();
  }
  const groupExists = () => {
    try { process.kill(-pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const send = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    return true;
  };
  if (!send("SIGTERM")) return false;
  const escalateAt = Date.now() + 250;
  while (groupExists() && Date.now() < escalateAt) await pause(25);
  if (groupExists() && !send("SIGKILL")) return false;
  while ((!closed() || groupExists()) && Date.now() < until) await pause(25);
  return closed() && !groupExists();
}

function pause(ms: number): Promise<void> { return new Promise(resolvePause => setTimeout(resolvePause, ms)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function collectProofloopAgentTrace(args: {
  adapterId: ProofloopAgentAdapterId;
  runDir: string;
  root?: string;
}): AgentTrace {
  const root = resolve(args.root ?? process.cwd());
  const evidenceFiles = existsSync(args.runDir)
    ? readdirSync(args.runDir)
      .filter((name) => /trace|eval|receipt|prompt|stdout|stderr|tooluse|meta|ledger|relaunch/i.test(name))
      .map((name) => rel(root, join(args.runDir, name)))
    : [];
  return {
    schema: "proofloop-agent-trace-v1",
    adapterId: args.adapterId,
    runDir: rel(root, args.runDir),
    evidenceFiles,
  };
}

export function buildAgentRepairPrompt(args: {
  adapterId: ProofloopAgentAdapterId;
  verdict: ProofloopVerdict;
  repairPrompt?: string;
  attempt?: number;
  maxAttempts?: number;
}): string {
  const failedGates = args.verdict.failedGates?.length ? args.verdict.failedGates.join("\n- ") : `Command exited ${args.verdict.exitCode}`;
  const attempt = args.attempt ?? 1;
  const maxAttempts = args.maxAttempts ?? 1;
  return [
    `You are ${agentDisplayName(args.adapterId)} continuing a Proof Loop repair loop. Fix the product or harness code so the next Proof Loop gate passes.`,
    "",
    "Non-negotiable rules:",
    "- Do not weaken verifiers, skip gates, lower thresholds, delete required evidence, or edit protected .proofloop hook/tooluse state.",
    "- If setup is missing, install or configure the local setup path instead of claiming it is blocked.",
    "- Exercise the real live UI path when the failure is a browser/live proof failure.",
    "- After changes, run the exact next command below and rely on its receipt, not a chat summary.",
    "",
    `Adapter: ${args.adapterId}`,
    `Loop attempt: ${attempt}/${maxAttempts}`,
    `Failed suite: ${args.verdict.suite}`,
    `Failed run: ${args.verdict.runId}`,
    `Failed command: ${args.verdict.cmd}`,
    `Score: ${args.verdict.score ?? "n/a"}/${args.verdict.minScore ?? "n/a"}`,
    "Failed gates:",
    `- ${failedGates}`,
    "",
    "Receipt paths:",
    ...(args.verdict.receiptPaths.length ? args.verdict.receiptPaths.map((path) => `- ${path}`) : ["- none"]),
    "",
    "Repair context from Proof Loop:",
    (args.repairPrompt ?? "").trim() || "(none)",
    "",
    "Next command after repair:",
    "npx proofloop gate",
    "",
  ].join("\n");
}

export function writeAgentRepairAttemptReceipt(args: {
  root: string;
  runDir: string;
  generatedAt?: string;
  adapterId: ProofloopAgentAdapterId;
  meta: ProofloopVerdict;
  repairPromptPath: string;
  attempt: number;
  maxAttempts: number;
  runResult: AgentRunResult;
}): string {
  const path = join(args.runDir, `${safeAgentId(args.adapterId)}-repair-attempt.json`);
  const receipt = {
    schema: "proofloop-agent-repair-attempt-v1",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    adapterId: args.adapterId,
    suite: args.meta.suite,
    failedRunId: args.meta.runId,
    attempt: args.attempt,
    maxAttempts: args.maxAttempts,
    repairPromptPath: rel(args.root, args.repairPromptPath),
    runResult: args.runResult,
    nextRunCommand: "npx proofloop gate",
  };
  writeJson(path, receipt);
  return path;
}

export function agentSetupReceiptPath(root: string, adapterId: ProofloopAgentAdapterId): string {
  return join(root, ".proofloop", "setup", "agents", `${safeAgentId(adapterId)}.json`);
}

function hookWorkerForAgent(adapterId: ProofloopAgentAdapterId): ProofloopHookWorker | undefined {
  if (adapterId === "codex") return "codex";
  if (adapterId === "claude-code") return "claude-code";
  return undefined;
}

function defaultLaunchCommand(adapterId: ProofloopAgentAdapterId, env: NodeJS.ProcessEnv): string | undefined {
  if (adapterId === "codex") return env.PROOFLOOP_CODEX_COMMAND?.trim() || "codex exec --json";
  if (adapterId === "claude-code") return env.PROOFLOOP_CLAUDE_CODE_COMMAND?.trim() || env.CLAUDE_CODE_COMMAND?.trim() || "claude --print --input-format text";
  if (adapterId === "generic-cli") return env.PROOFLOOP_GENERIC_AGENT_COMMAND?.trim();
  return undefined;
}

function adapterSetupMessage(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string {
  if (status === "ready") return `${adapterId} adapter is ready.`;
  if (adapterId === "cursor") return "Cursor needs a wrapper or extension command that can accept a repair prompt and export session evidence.";
  if (adapterId === "windsurf") return "Windsurf needs a Cascade/session adapter that can accept a repair prompt and export session evidence.";
  if (adapterId === "devin") return "Devin needs API/session export and relaunch hooks before Proof Loop can automate it.";
  return `${adapterId} adapter needs a launch command.`;
}

function traceCaptureForAgent(adapterId: ProofloopAgentAdapterId): string[] {
  if (adapterId === "codex" || adapterId === "claude-code" || adapterId === "generic-cli") {
    return ["Proof Loop gate receipts", ".proofloop/tooluse/log.jsonl", "agent stdout/stderr", "git diff"];
  }
  return ["adapter-required: command logs", "adapter-required: file diffs", "adapter-required: screenshots/tool calls"];
}

function gateEnforcementForAgent(adapterId: ProofloopAgentAdapterId, hookHost?: ProofloopHookWorker): string[] {
  if (hookHost) return [`${hookHost} Stop hook`, `${hookHost} PreToolUse guard`, "Proof Loop verifier receipts"];
  if (adapterId === "generic-cli") return ["wrapper CLI exit code", "Proof Loop verifier receipts"];
  return ["adapter-required: hook, wrapper CLI, or policy layer"];
}

function nextCommandsForAgent(adapterId: ProofloopAgentAdapterId, status: ProofloopAgentAdapterStatus): string[] {
  if (status === "ready") {
    return [
      `npx proofloop codex-loop --agent ${adapterId}`,
      `npx proofloop agents setup ${adapterId}`,
      "npx proofloop gate",
    ];
  }
  if (status === "needs_command") return [`npx proofloop agents setup ${adapterId} --command "<agent command>"`];
  return [`Implement a ${adapterId} launch/trace/gate adapter, then rerun agents setup.`];
}

function agentDisplayName(adapterId: ProofloopAgentAdapterId): string {
  if (adapterId === "claude-code") return "Claude Code";
  if (adapterId === "generic-cli") return "a generic CLI agent";
  return adapterId[0].toUpperCase() + adapterId.slice(1);
}

function safeAgentId(adapterId: ProofloopAgentAdapterId): string {
  return adapterId.replace(/[^a-z0-9-]/gi, "-");
}

function rel(root: string, path: string): string {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
