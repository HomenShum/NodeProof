import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildAgentRepairPrompt,
  launchProofloopAgentAdapter,
  writeAgentRepairAttemptReceipt,
  type ProofloopAgentAdapterId,
  type ProofloopVerdict,
} from "./agentAdapters";
import { writeCodexRelaunchPacket } from "./codexRelaunch";
import { gateStatePath, runGateCli, type GateState } from "./gate";

export type ProofloopAgentLoopResult = {
  runId: string;
  exitCode: number;
  attempts: number;
  passed: boolean;
  runDir: string;
  repairPromptPath?: string;
};

export async function runProofloopAgentLoop(options: {
  root?: string;
  agentId?: ProofloopAgentAdapterId;
  maxAttempts?: number;
  dryRun?: boolean;
  command?: string;
  runId?: string;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}): Promise<ProofloopAgentLoopResult> {
  const root = resolve(options.root ?? process.cwd());
  const agentId = options.agentId ?? "codex";
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const runId = options.runId ?? `gate-${compactTimestamp(new Date())}`;
  const runDir = join(root, ".proofloop", "runs", runId);
  mkdirSync(runDir, { recursive: true });

  let lastExit = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastExit = runGateCli({
      root,
      log: options.log ?? console.log,
      logError: options.logError ?? console.error,
    });
    const state = readGateState(root);
    const verdict = verdictFromGate(runId, state, lastExit);
    writeJson(join(runDir, `gate-attempt-${attempt}.json`), state ?? { missing: gateStatePath(root), exitCode: lastExit });
    if (verdict.passed) {
      return { runId, exitCode: 0, attempts: attempt, passed: true, runDir };
    }

    const repairPromptPath = join(runDir, `${safeAgentId(agentId)}-repair-prompt-${attempt}.md`);
    const prompt = buildAgentRepairPrompt({
      adapterId: agentId,
      verdict,
      repairPrompt: repairContextFromGate(state),
      attempt,
      maxAttempts,
    });
    writeFileSync(repairPromptPath, prompt, "utf8");
    if (agentId === "codex") writeCodexRelaunchPacket({ root, runDir, verdict, repairPromptPath, force: true });

    const runResult = options.dryRun
      ? {
        adapterId: agentId,
        status: "needs_command" as const,
        launched: false,
        promptPath: repairPromptPath,
        message: "dry run; agent was not launched",
      }
      : launchProofloopAgentAdapter({
        adapterId: agentId,
        promptPath: repairPromptPath,
        targetDir: root,
        ...(options.command ? { command: options.command } : {}),
      });
    writeAgentRepairAttemptReceipt({
      root,
      runDir,
      adapterId: agentId,
      meta: verdict,
      repairPromptPath,
      attempt,
      maxAttempts,
      runResult,
    });

    if (options.dryRun || !runResult.launched || runResult.status === "failed") {
      return { runId, exitCode: lastExit || 1, attempts: attempt, passed: false, runDir, repairPromptPath };
    }
  }
  return { runId, exitCode: lastExit || 1, attempts: maxAttempts, passed: false, runDir };
}

function readGateState(root: string): GateState | undefined {
  const path = gateStatePath(root);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GateState;
  } catch {
    return undefined;
  }
}

function verdictFromGate(runId: string, state: GateState | undefined, exitCode: number): ProofloopVerdict {
  const failedChecks = state?.checks.filter((check) => !check.pass).map((check) => check.name) ?? [];
  return {
    runId,
    suite: "proofloop-gate",
    cmd: "npx proofloop gate",
    passed: exitCode === 0,
    exitCode,
    failedGates: failedChecks.length ? failedChecks : exitCode === 0 ? [] : [state?.status ?? "gate_unavailable"],
    receiptPaths: [".proofloop/gate-state.json"],
  };
}

function repairContextFromGate(state: GateState | undefined): string {
  if (!state) return "No gate-state.json was produced. Run `npx proofloop doctor --json` and configure proofloop.config.json checks.";
  if (state.status === "no_gate") return "No proof gate is configured. Add deterministic proofloop.config.json gate.checks before claiming done.";
  const failed = state.checks.filter((check) => !check.pass);
  if (!failed.length) return `Gate status is ${state.status}.`;
  return failed.map((check) => `${check.name}: ${check.command} exited ${check.exitCode ?? "error"} after ${check.ms}ms`).join("\n");
}

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function safeAgentId(adapterId: ProofloopAgentAdapterId): string {
  return adapterId.replace(/[^a-z0-9-]/gi, "-");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
