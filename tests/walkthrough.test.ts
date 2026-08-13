/**
 * The walkthrough must match the commit it ships with.
 *
 * `.tours/*.tour` and `docs/START_HERE.md` point a new reader at exact files and
 * line numbers. A tour whose line has drifted is worse than no tour: it teaches
 * the reader something false and costs them the time to discover that. These
 * tests are the drift detector.
 *
 * ANCHORS below is the contract: for every line the walkthrough cites, the text
 * that line must still contain. Move a function and this test fails, naming the
 * document to update. Do not fix a failure by loosening the expected text —
 * fix the document, or move the anchor to the line that now holds the symbol.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const toursDir = join(root, ".tours");

type TourStep = { file?: string; line?: number; title?: string; description?: string };
type Tour = { title?: string; steps?: TourStep[] };

function lines(relPath: string): string[] {
  return readFileSync(join(root, relPath), "utf8").split(/\r?\n/);
}

/** [file, 1-indexed line, text that line must contain] */
const ANCHORS: Array<[string, number, string]> = [
  ["src/cli.ts", 99, "MCP_SERVER_RUNNING"],
  ["src/cli.ts", 185, "export function runCli"],
  ["src/cli.ts", 210, 'case "gate":'],
  ["src/cli.ts", 499, "runCodexLoopCommand"],
  ["src/cli.ts", 958, "runHooksCommand"],
  ["src/cli.ts", 1046, "require.main === module"],
  ["src/gate.ts", 21, "GATE_STATE_RELATIVE_PATH"],
  ["src/gate.ts", 53, "export function statusToExit"],
  ["src/gate.ts", 73, "function writeGateState"],
  ["src/gate.ts", 92, "function runCommand"],
  ["src/gate.ts", 113, "export function runGate"],
  ["src/gate.ts", 155, "const state: GateState"],
  ["src/gate.ts", 162, "writeGateState(root, state)"],
  ["src/gate.ts", 169, "export function runGateCli"],
  ["src/gate.ts", 191, "export function formatGateState"],
  ["src/config.ts", 50, "export function readConfig"],
  ["src/config.ts", 63, "export function normalizeConfig"],
  ["src/agentLoop.ts", 22, "export async function runProofloopAgentLoop"],
  ["src/agentLoop.ts", 40, "for (let attempt = 1"],
  ["src/agentLoop.ts", 89, "options.dryRun"],
  ["src/agentLoop.ts", 106, "function verdictFromGate"],
  ["src/mcp.ts", 28, "const TOOLS: McpTool[]"],
  ["src/mcp.ts", 56, "export function startMcpServer"],
  ["src/proofloopToolUse.ts", 519, "export function verifyToolUseContract"],
  ["src/proofloopHooks.ts", 60, "DEFAULT_GATE_COMMAND"],
  ["src/proofloopHooks.ts", 114, "ProofloopHookWorker"],
  ["src/proofloopHooks.ts", 172, "export function installProofloopHooks"],
  ["src/proofloopHooks.ts", 504, "function stopGateScript"],
  ["src/proofloopHooks.ts", 653, "Loop protection FIRST"],
  ["src/proofloopHooks.ts", 693, 'decision: "block"'],
  ["src/proofloopHooks.ts", 1044, "function hookSettingsPath"],
  ["src/project.ts", 518, "export function buildResume"],
  ["tests/gate.test.ts", 77, "PowerShell UTF-8 BOM"],
  ["tests/gate.test.ts", 88, 'describe("proofloop gate"'],
  ["api/hosted/_shared.js", 72, "function verifiedHostAllowlist"],
  ["public/app.js", 10, "function setStatus"],
  ["public/app.js", 23, "function normalizeTarget"],
  ["public/app.js", 32, "function githubRepo"],
  ["public/app.js", 44, "function githubCommand"],
  ["public/app.js", 89, "async function submitTarget"],
  ["public/app.js", 127, 'setStatus("blocked", data.status'],
  ["public/app.js", 138, 'submit.addEventListener("click"'],
  ["promotion/PROMOTION_LOG.md", 64, "| D1 |"],
];

describe("walkthrough anchors resolve to the current source", () => {
  it.each(ANCHORS)("%s:%i still contains %s", (relPath, line, expected) => {
    expect(existsSync(join(root, relPath)), `${relPath} is missing`).toBe(true);
    const content = lines(relPath);
    expect(content.length, `${relPath} has fewer than ${line} lines`).toBeGreaterThanOrEqual(line);
    expect(content[line - 1]).toContain(expected);
  });
});

describe("CodeTours", () => {
  const tourFiles = readdirSync(toursDir).filter((name) => name.endsWith(".tour"));

  it("ships the three tours the walkthrough promises", () => {
    expect(tourFiles.sort()).toEqual([
      "01-primary-user-flow.tour",
      "02-agent-execution.tour",
      "03-debug-and-recovery.tour",
    ]);
  });

  it.each(tourFiles)("%s points every step at a real file and an in-range line", (name) => {
    const tour = JSON.parse(readFileSync(join(toursDir, name), "utf8")) as Tour;
    expect(tour.title, `${name} has no title`).toBeTruthy();
    expect(tour.steps?.length, `${name} has no steps`).toBeGreaterThan(0);

    for (const step of tour.steps ?? []) {
      expect(step.file, `${name}: a step has no file`).toBeTruthy();
      expect(existsSync(join(root, step.file!)), `${name}: ${step.file} does not exist`).toBe(true);
      expect(step.line, `${name}: ${step.file} step has no line`).toBeGreaterThan(0);
      expect(
        lines(step.file!).length,
        `${name}: ${step.file}:${step.line} is past the end of the file`,
      ).toBeGreaterThanOrEqual(step.line!);
      expect(step.description, `${name}: ${step.file}:${step.line} has no description`).toBeTruthy();
    }
  });
});

describe("START_HERE stays in step with the code", () => {
  const startHere = readFileSync(join(root, "docs", "START_HERE.md"), "utf8");

  it("keeps the gate's required stages in runtime order", () => {
    const headings = [...startHere.matchAll(/^## Step (\d+|W\d+) — (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "W1", "W2", "W3", "W4"]);
  });

  it("only cites files that exist", () => {
    const cited = new Set([...startHere.matchAll(/`((?:src|api|public|tests|scripts|promotion|docs)\/[\w./-]+)`/g)].map((m) => m[1]));
    const missing = [...cited].filter((relPath) => !existsSync(join(root, relPath)));
    expect(missing).toEqual([]);
  });
});
