import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ProofloopVerdict } from "./agentAdapters";

export type ProofloopCodexRelaunchPacket = {
  schema: "proofloop-codex-relaunch-v1";
  generatedAt: string;
  runId: string;
  suite: string;
  passed: false;
  failure: {
    exitCode: number;
    failedGates: string[];
    score?: number;
    minScore?: number;
  };
  receipts: {
    repairPrompt: string;
    proofReceipts: string[];
  };
  commands: {
    gate: string;
    codexReprompt: string;
    codexRelaunch: string;
    installCodexHooks: string;
  };
  codexPrompt: string;
};

export type ProofloopCodexRelaunchResult = {
  wrote: boolean;
  packetPath: string;
  promptPath: string;
  packet?: ProofloopCodexRelaunchPacket;
};

export function writeCodexRelaunchPacket(args: {
  root?: string;
  runDir: string;
  verdict: ProofloopVerdict;
  repairPromptPath: string;
  force?: boolean;
}): ProofloopCodexRelaunchResult {
  const packetPath = join(args.runDir, "codex-relaunch.json");
  const promptPath = join(args.runDir, "codex-reprompt.md");
  if (args.verdict.passed && !args.force) return { wrote: false, packetPath, promptPath };

  const root = resolve(args.root ?? process.cwd());
  mkdirSync(args.runDir, { recursive: true });
  const packet: ProofloopCodexRelaunchPacket = {
    schema: "proofloop-codex-relaunch-v1",
    generatedAt: new Date().toISOString(),
    runId: args.verdict.runId,
    suite: args.verdict.suite,
    passed: false,
    failure: {
      exitCode: args.verdict.exitCode,
      failedGates: args.verdict.failedGates ?? [],
      ...(args.verdict.score !== undefined ? { score: args.verdict.score } : {}),
      ...(args.verdict.minScore !== undefined ? { minScore: args.verdict.minScore } : {}),
    },
    receipts: {
      repairPrompt: rel(root, args.repairPromptPath),
      proofReceipts: args.verdict.receiptPaths,
    },
    commands: {
      gate: "npx proofloop gate",
      codexReprompt: `npx proofloop codex reprompt ${args.verdict.runId}`,
      codexRelaunch: `npx proofloop codex relaunch ${args.verdict.runId}`,
      installCodexHooks: "npx proofloop hooks install --worker codex --local",
    },
    codexPrompt: renderCodexReprompt({
      verdict: args.verdict,
      repairPromptPath: rel(root, args.repairPromptPath),
    }),
  };

  writeJson(packetPath, packet);
  writeFileSync(promptPath, `${packet.codexPrompt}\n`, "utf8");
  return { wrote: true, packetPath, promptPath, packet };
}

export function readCodexReprompt(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function codexRunDir(root: string, runId: string): string {
  return join(resolve(root), ".proofloop", "runs", runId);
}

export function latestProofloopRunDir(root: string): string | undefined {
  const runsDir = join(resolve(root), ".proofloop", "runs");
  if (!existsSync(runsDir)) return undefined;
  return readdirSync(runsDir)
    .map((name) => join(runsDir, name))
    .filter((path) => existsSync(path) && statSync(path).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function renderCodexReprompt(args: {
  verdict: ProofloopVerdict;
  repairPromptPath: string;
}): string {
  const gates = args.verdict.failedGates?.length ? args.verdict.failedGates.join(", ") : `exit_${args.verdict.exitCode}`;
  const receipts = args.verdict.receiptPaths.length ? args.verdict.receiptPaths.join("\n- ") : "none";
  return [
    "# Codex Proof Loop Repair Prompt",
    "",
    "You are Codex repairing a failed Proof Loop run. Do not claim the work is done until the deterministic gate or proof receipt passes.",
    "",
    `Run: ${args.verdict.runId}`,
    `Suite: ${args.verdict.suite}`,
    `Command: ${args.verdict.cmd}`,
    `Failed gates: ${gates}`,
    `Repair prompt: ${args.repairPromptPath}`,
    "",
    "Proof receipts:",
    `- ${receipts}`,
    "",
    "Required loop:",
    "1. Read the repair prompt and receipts above.",
    "2. Make the smallest product or harness change that addresses the first failing gate.",
    "3. Add or update deterministic coverage for the failure.",
    "4. Rerun `npx proofloop gate`.",
    "5. Stop only after the verifier passes and the new receipt is recorded.",
  ].join("\n");
}

function rel(root: string, path: string): string {
  const relativePath = relative(root, path).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : path.replace(/\\/g, "/");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
