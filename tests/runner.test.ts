import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runProofloopRunner,
  readRunnerPlan,
  runnerLedgerPath,
  runnerRunDir,
  runnerStatePath,
  type ProofloopRunnerPlan,
  type ProofloopRunnerState,
} from "../src/runner";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-runner-"));
  tempRoots.push(root);
  return root;
}

function writePlan(root: string, plan: ProofloopRunnerPlan): string {
  const path = join(root, "proofloop.runner.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

function readState(root: string, runId: string): ProofloopRunnerState {
  return JSON.parse(readFileSync(runnerStatePath(runnerRunDir(root, runId)), "utf8")) as ProofloopRunnerState;
}

describe("proofloop runner", () => {
  it("enforces the budget kill-switch and redacts secret output in the append-only ledger", async () => {
    const root = tempRoot();
    const secret = "supersecret-runner-token";
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [
        {
          id: "echo-secret",
          command: nodeCommand("console.log(process.env.SECRET_TOKEN); console.log('sk-'+'abcdefghijklmno'); console.log('API_KEY='+'plainvalue')"),
          env: { SECRET_TOKEN: secret },
          estimatedCostUsd: 0.4,
        },
        {
          id: "too-expensive",
          command: nodeCommand("process.exit(0)"),
          estimatedCostUsd: 0.7,
        },
      ],
    });

    const result = await runProofloopRunner({
      root,
      subcommand: "run",
      planPath,
      runId: "budget",
      budgetUsd: 1,
      log: () => {},
      logError: () => {},
    });

    expect(result.exitCode).toBe(3);
    expect(result.state.status).toBe("blocked_budget");
    expect(result.state.spentEstimatedUsd).toBe(0.4);
    expect(result.state.taskStates.map((task) => task.status)).toEqual(["passed", "blocked_budget"]);
    const ledger = readFileSync(runnerLedgerPath(runnerRunDir(root, "budget")), "utf8");
    expect(ledger).toContain("budget_kill_switch");
    expect(ledger).not.toContain(secret);
    expect(ledger).not.toContain("sk-abcdefghijklmno");
    expect(ledger).not.toContain("API_KEY=plainvalue");
    expect(ledger).toContain("[redacted:SECRET_TOKEN]");
    expect(ledger).toContain("[redacted:token]");
    expect(ledger).toContain("API_KEY=[redacted:API_KEY]");
  });

  it("fails closed on unknown plan keys and embedded secret-like tokens", () => {
    const root = tempRoot();
    const unknownTop = join(root, "unknown-top.json");
    writeFileSync(unknownTop, JSON.stringify({
      schema: "proofloop-runner-plan-v1",
      surprise: true,
      tasks: [{ id: "one", command: nodeCommand("process.exit(0)") }],
    }), "utf8");
    expect(() => readRunnerPlan(unknownTop)).toThrow(/unknown key "surprise"/);

    const unknownTask = join(root, "unknown-task.json");
    writeFileSync(unknownTask, JSON.stringify({
      schema: "proofloop-runner-plan-v1",
      tasks: [{ id: "one", command: nodeCommand("process.exit(0)"), retries: 3 }],
    }), "utf8");
    expect(() => readRunnerPlan(unknownTask)).toThrow(/unknown key "retries"/);

    const secret = join(root, "secret.json");
    writeFileSync(secret, JSON.stringify({
      schema: "proofloop-runner-plan-v1",
      tasks: [{ id: "one", command: "echo sk-1234567890abcdef" }],
    }), "utf8");
    expect(() => readRunnerPlan(secret)).toThrow(/embedded secret-like token/);
  });

  it("fails closed when a fresh single-flight lock already exists", async () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [{ id: "one", command: nodeCommand("process.exit(0)") }],
    });
    const runDir = runnerRunDir(root, "locked");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.lock"), JSON.stringify({ pid: process.pid, token: "held" }), "utf8");

    const result = await runProofloopRunner({
      root,
      subcommand: "run",
      planPath,
      runId: "locked",
      lockTtlMs: 60_000,
      log: () => {},
      logError: () => {},
    });

    expect(result.exitCode).toBe(2);
    expect(result.state.status).toBe("failed");
    expect(result.state.taskStates[0]?.error).toContain("runner lock is held");
  });

  it("requires explicit --clear-stale-lock before taking over a dead-pid lock", async () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [{ id: "one", command: nodeCommand("process.exit(0)") }],
    });
    const runDir = runnerRunDir(root, "stale-lock");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.lock"), JSON.stringify({ pid: 999999999, token: "dead" }), "utf8");

    const blocked = await runProofloopRunner({
      root,
      subcommand: "run",
      planPath,
      runId: "stale-lock",
      lockTtlMs: 60_000,
      log: () => {},
      logError: () => {},
    });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.state.taskStates[0]?.error).toContain("--clear-stale-lock");

    const cleared = await runProofloopRunner({
      root,
      subcommand: "run",
      planPath,
      runId: "stale-lock",
      lockTtlMs: 60_000,
      clearStaleLock: true,
      log: () => {},
      logError: () => {},
    });
    expect(cleared.exitCode).toBe(0);
    expect(cleared.state.status).toBe("passed");
  });

  it("resumes a task left running after the CLI process is killed", async () => {
    const root = tempRoot();
    const marker = join(root, "marker.txt");
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [{
        id: "killable",
        command: nodeCommand([
          "const fs=require('fs');",
          "const p=process.env.MARKER;",
          "if (fs.existsSync(p)) process.exit(0);",
          "fs.writeFileSync(p,'started');",
          "setTimeout(()=>{},30000);",
        ].join(" ")),
        env: { MARKER: marker },
        estimatedCostUsd: 0,
        timeoutMs: 60_000,
      }],
    });
    const distCli = join(process.cwd(), "dist", "cli.js");
    expect(existsSync(distCli)).toBe(true);

    const child = spawn(process.execPath, [
      distCli,
      "--dir",
      root,
      "runner",
      "run",
      "--plan",
      planPath,
      "--run-id",
      "crash",
      "--budget-usd",
      "1",
    ], { stdio: "ignore" });

    await waitFor(() => readFileSync(runnerLedgerPath(runnerRunDir(root, "crash")), "utf8").includes("task_started"), 10_000);
    await waitFor(() => existsSync(marker), 10_000);
    killProcessTree(child);
    await waitForChildExit(child, 10_000);

    expect(readState(root, "crash").taskStates[0]?.status).toBe("running");

    const blockedResume = spawnSync(process.execPath, [
      distCli,
      "--dir",
      root,
      "runner",
      "resume",
    ], { encoding: "utf8" });
    expect(blockedResume.status).toBe(2);
    expect(blockedResume.stderr).toContain("--clear-stale-lock");

    const resume = spawnSync(process.execPath, [
      distCli,
      "--dir",
      root,
      "runner",
      "resume",
      "--clear-stale-lock",
    ], { encoding: "utf8" });
    expect(resume.status).toBe(0);
    const state = readState(root, "crash");
    expect(state.status).toBe("passed");
    expect(state.taskStates[0]?.attempts).toBe(2);
    const ledger = readFileSync(runnerLedgerPath(runnerRunDir(root, "crash")), "utf8");
    expect(ledger).toContain("stale_running_requeued");
  });

  it("repairs a torn ledger tail only after taking the runner lock", async () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [{ id: "one", command: nodeCommand("process.exit(0)") }],
    });
    await runProofloopRunner({ root, subcommand: "run", planPath, runId: "tail", log: () => {}, logError: () => {} });
    const ledgerPath = runnerLedgerPath(runnerRunDir(root, "tail"));
    appendFileSync(ledgerPath, "{\"schema\":\"torn-tail-junk\"", "utf8");

    const result = await runProofloopRunner({ root, subcommand: "resume", runId: "tail", log: () => {}, logError: () => {} });
    expect(result.exitCode).toBe(0);
    const ledger = readFileSync(ledgerPath, "utf8");
    expect(ledger).toContain("ledger_torn_tail_repaired");
    expect(ledger).not.toContain("torn-tail-junk");
  });

  it("prints an honest runner report with family and model summaries", async () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      schema: "proofloop-runner-plan-v1",
      tasks: [
        { id: "family.one", command: nodeCommand("process.exit(0)"), env: { BENCH_AGENT_MODEL_POLICY: "free/model:free" }, estimatedCostUsd: 0 },
      ],
    });
    await runProofloopRunner({ root, subcommand: "run", planPath, runId: "report", log: () => {}, logError: () => {} });
    const logs: string[] = [];
    const result = await runProofloopRunner({ root, subcommand: "report", runId: "report", log: (message) => logs.push(message), logError: () => {} });
    expect(result.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("Proxy product proof, NOT an official benchmark score");
    expect(logs.join("\n")).toContain("| family | 1 | 1 | 100% | $0.000000 |");
    expect(logs.join("\n")).toContain("| free/model:free | 1 | 1 | 100% | $0.000000 |");
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error("timed out waiting for condition");
}

function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for child exit")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) throw new Error("child pid missing");
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill("SIGTERM");
}
