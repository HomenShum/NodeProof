import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { installProofloopHooks, type ProofloopHookWorker } from "./proofloopHooks";

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
  launch(promptPath: string, targetDir: string, options?: { command?: string; env?: NodeJS.ProcessEnv }): Promise<AgentRunResult>;
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
    launch: (promptPath, targetDir, options) => Promise.resolve(launchProofloopAgentAdapter({ adapterId: id, promptPath, targetDir, ...options })),
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

export function launchProofloopAgentAdapter(args: {
  adapterId: ProofloopAgentAdapterId;
  promptPath: string;
  targetDir?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
}): AgentRunResult {
  const targetDir = resolve(args.targetDir ?? process.cwd());
  const env = args.env ?? process.env;
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

  const prompt = readFileSync(args.promptPath, "utf8");
  const result = spawnSync(command, {
    cwd: targetDir,
    shell: true,
    input: prompt,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    env: {
      ...env,
      PROOFLOOP_AGENT_ADAPTER: args.adapterId,
      PROOFLOOP_REPAIR_PROMPT: args.promptPath,
    },
  });
  const stdoutPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stdout.log`);
  const stderrPath = join(dirname(args.promptPath), `${safeAgentId(args.adapterId)}-stderr.log`);
  writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(stderrPath, result.stderr ?? "", "utf8");
  const exitCode = result.status ?? 1;
  return {
    adapterId: args.adapterId,
    status: exitCode === 0 ? "launched" : "failed",
    launched: true,
    command,
    promptPath: rel(targetDir, args.promptPath),
    exitCode,
    stdoutPath: rel(targetDir, stdoutPath),
    stderrPath: rel(targetDir, stderrPath),
    message: exitCode === 0 ? `${args.adapterId} completed; rerun the Proof Loop gate.` : `${args.adapterId} exited ${exitCode}.`,
  };
}

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
