/**
 * Scenario tests for `proofloop run <init|start|resume|status|report>` -- the
 * durable long-run benchmark executor.
 *
 * Persona: a solo founder queues thousands of model x task benchmark attempts
 * (the noderoom prod proxy matrix shape) on a laptop where the internet drops,
 * the process gets killed, and the OpenRouter budget is a hard $100. Every
 * test drives the REAL compiled dist/cli.js as a subprocess with tiny `node -e`
 * commands as fake attempts, in mkdtemp dirs -- no mocks of the runner itself.
 *
 * Covered angles: happy path + receipts/costs, crash mid-attempt + resume,
 * torn ledger tail + mid-file corruption (fail-closed), budget exhaustion +
 * budget raise, retries (recover and exhaust), stale vs live locks, secret
 * redaction, fail-closed plan validation, concurrency, and the PACKAGE_COMMANDS
 * honesty registration.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_COMMANDS } from "../src/prompt";
import type { LongRunLedgerRecord, LongRunReport } from "../src/longrun";

const REPO_ROOT = resolve(__dirname, "..");
const CLI_DIST = join(REPO_ROOT, "dist", "cli.js");

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // A just-killed orphan child may briefly hold the dir on Windows; leaking
      // a temp dir is preferable to failing an otherwise-green scenario.
    }
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-longrun-"));
  tempRoots.push(root);
  return root;
}

/** Forward-slash a path so it can be embedded inside a `node -e` script. */
function fp(path: string): string {
  return path.replace(/\\/g, "/");
}

function runCliSync(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_DIST, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** An attempt command that appends one byte to a counter file (execution proof). */
function counterCmd(counterFile: string, extraScript = ""): string[] {
  return [process.execPath, "-e", `const fs=require('fs');fs.appendFileSync('${fp(counterFile)}','x');${extraScript}`];
}

function countExecutions(counterFile: string): number {
  return existsSync(counterFile) ? readFileSync(counterFile, "utf8").length : 0;
}

function attempt(id: string, command: string[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, family: `fam-${id[0]}`, taskId: `task-${id}`, model: `test/model-${id[0]}`, command, timeoutMs: 30_000, estCostUsd: 0.01, ...overrides };
}

function writePlan(root: string, plan: Record<string, unknown>): string {
  const path = join(root, "plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}

function ledgerPath(root: string, runId: string): string {
  return join(root, ".proofloop", "longrun", runId, "ledger.jsonl");
}

function readLedger(root: string, runId: string): LongRunLedgerRecord[] {
  return readFileSync(ledgerPath(root, runId), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LongRunLedgerRecord);
}

function ofType<T extends LongRunLedgerRecord["type"]>(records: LongRunLedgerRecord[], type: T): Extract<LongRunLedgerRecord, { type: T }>[] {
  return records.filter((record) => record.type === type) as Extract<LongRunLedgerRecord, { type: T }>[];
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

describe("proofloop run -- happy path (overnight operator, 3 attempts)", () => {
  it("executes all attempts, records receipts + actual costs, reports honestly, and start refuses a second execution", () => {
    const root = tempRoot();
    const c1 = join(root, "c1.txt");
    const c2 = join(root, "c2.txt");
    const c3 = join(root, "c3.txt");
    // a2 behaves like a real benchmark adapter: it writes a receipt and an
    // actual-cost file to the paths the runner hands it via env.
    const a2Script =
      `fs.writeFileSync(process.env.PROOFLOOP_RECEIPT_FILE,JSON.stringify({proof:'adapter-receipt',attempt:process.env.PROOFLOOP_ATTEMPT_ID}));` +
      `fs.writeFileSync(process.env.PROOFLOOP_COST_FILE,JSON.stringify({actualCostUsd:0.05}));`;
    const plan = {
      budgetUsd: 10,
      attempts: [
        attempt("a1", counterCmd(c1)),
        attempt("a2", counterCmd(c2, a2Script), { family: "fam-x", model: "test/model-x", estCostUsd: 0.02 }),
        attempt("a3", counterCmd(c3)),
      ],
    };
    const planPath = writePlan(root, plan);

    const init = runCliSync(["run", "init", "--plan", planPath, "--id", "happy", "--dir", root], root);
    expect(init.stderr).toBe("");
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('created run "happy"');

    const start = runCliSync(["run", "start", "--run", "happy", "--dir", root], root);
    expect(start.status).toBe(0);
    expect([countExecutions(c1), countExecutions(c2), countExecutions(c3)]).toEqual([1, 1, 1]);

    // Ledger: exactly 3 attempt_start + 3 attempt_end (the "6 records" of the
    // attempt log), plus the run lifecycle records around them.
    const records = readLedger(root, "happy");
    expect(ofType(records, "attempt_start")).toHaveLength(3);
    const ends = ofType(records, "attempt_end");
    expect(ends).toHaveLength(3);
    expect(ofType(records, "run_created")).toHaveLength(1);
    expect(ofType(records, "run_started")).toHaveLength(1);
    expect(ofType(records, "run_completed")).toHaveLength(1);
    expect(ends.every((end) => end.verdict === "pass")).toBe(true);

    // a2's end record carries the ACTUAL cost + receipt; the others fall back
    // to the estimate and say so (no fake "measured" claims).
    const a2End = ends.find((end) => end.attemptId === "a2")!;
    expect(a2End.costSource).toBe("actual");
    expect(a2End.costUsd).toBe(0.05);
    expect(a2End.receiptPath).toContain("receipts/a2.try1.json");
    const a1End = ends.find((end) => end.attemptId === "a1")!;
    expect(a1End.costSource).toBe("estimate");
    expect(a1End.receiptPath).toBeNull();

    // start refuses to touch a run with history; resume is idempotent on a
    // complete run (summary + exit 0, nothing re-executed).
    const startAgain = runCliSync(["run", "start", "--run", "happy", "--dir", root], root);
    expect(startAgain.status).toBe(2);
    expect(startAgain.stderr).toContain("resume");
    const resume = runCliSync(["run", "resume", "--run", "happy", "--dir", root], root);
    expect(resume.status).toBe(0);
    expect(resume.stdout).toContain("already complete");
    expect([countExecutions(c1), countExecutions(c2), countExecutions(c3)]).toEqual([1, 1, 1]);

    // status: informational table.
    const status = runCliSync(["run", "status", "--run", "happy", "--dir", root], root);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("3 total | 3 done (3 passed, 0 failed) | 0 remaining");
    expect(status.stdout).toContain("lock:     none");

    // report: JSON + markdown, family/model vocabulary, honest framing.
    const report = runCliSync(["run", "report", "--run", "happy", "--json", "--dir", root], root);
    expect(report.status).toBe(0);
    const parsed = JSON.parse(report.stdout) as LongRunReport;
    expect(parsed.schema).toBe("proofloop-longrun-report-v1");
    expect(parsed.framing).toContain("NOT an official benchmark score");
    expect(parsed.summary).toMatchObject({ attemptTargets: 3, passed: 3, failed: 0, remaining: 0, complete: true, allPassed: true });
    expect(parsed.summary.spentUsd).toBeCloseTo(0.07, 6); // 0.01 est + 0.05 actual + 0.01 est
    expect(parsed.summary.measuredCostUsd).toBeCloseTo(0.05, 6);
    const famX = parsed.families.find((row) => row.id === "fam-x")!;
    expect(famX).toMatchObject({ attempts: 1, passed: 1, passRate: 1 });
    const modelX = parsed.modelSummaries.find((row) => row.modelId === "test/model-x")!;
    expect(modelX.measuredCostUsd).toBeCloseTo(0.05, 6);
    expect(typeof modelX.avgDurationMs).toBe("number");
    // The markdown twin is written next to the ledger for merging into docs.
    const runDir = join(root, ".proofloop", "longrun", "happy");
    expect(existsSync(join(runDir, "report.md"))).toBe(true);
    expect(readFileSync(join(runDir, "report.md"), "utf8")).toContain("| modelId |");
    expect(existsSync(join(runDir, "report.json"))).toBe(true);
  });
});

describe("proofloop run -- crash mid-attempt (laptop dies, operator resumes)", () => {
  it("hard-killing the runner loses nothing: resume re-runs only the in-flight attempt; finished attempts execute exactly once", async () => {
    const root = tempRoot();
    const c1 = join(root, "c1.txt");
    const c2 = join(root, "c2.txt");
    const c3 = join(root, "c3.txt");
    const die = join(root, "die.marker");
    // a2's FIRST execution parks until the die-marker appears (so we can kill
    // the runner mid-attempt); its SECOND execution exits 0 immediately.
    const a2Wait =
      `if(fs.readFileSync('${fp(c2)}','utf8').length<2){` +
      `const t=setInterval(()=>{if(fs.existsSync('${fp(die)}'))process.exit(0)},100);` +
      `setTimeout(()=>process.exit(0),60000);}`;
    const planPath = writePlan(root, {
      budgetUsd: 10,
      attempts: [attempt("a1", counterCmd(c1)), attempt("a2", counterCmd(c2, a2Wait)), attempt("a3", counterCmd(c3))],
    });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "crash", "--dir", root], root).status).toBe(0);

    // Start the runner detached-ish and kill it while a2 is in flight.
    const runner = spawn(process.execPath, [CLI_DIST, "run", "start", "--run", "crash", "--dir", root], { cwd: root, stdio: "ignore" });
    const runnerExit = new Promise<void>((resolveExit) => runner.on("exit", () => resolveExit()));
    await waitFor(() => countExecutions(c2) >= 1, 20_000, "attempt a2 to start");
    runner.kill("SIGKILL"); // hard death -- no graceful handler, exactly like a power cut
    await runnerExit;
    writeFileSync(die, "die", "utf8"); // release the orphaned a2 child so it exits promptly

    // The dead runner left its lock behind: resume must refuse until the
    // operator explicitly clears the stale lock (pid is dead).
    const blocked = runCliSync(["run", "resume", "--run", "crash", "--dir", root], root);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("STALE lock");
    const status = runCliSync(["run", "status", "--run", "crash", "--dir", root], root);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("STALE");

    const resume = runCliSync(["run", "resume", "--run", "crash", "--dir", root, "--clear-stale-lock"], root);
    expect(resume.status).toBe(0);
    expect(resume.stdout).toContain("cleared stale lock");

    // a1 executed exactly ONCE across both processes; the in-flight a2 re-ran.
    expect(countExecutions(c1)).toBe(1);
    expect(countExecutions(c2)).toBe(2);
    expect(countExecutions(c3)).toBe(1);
    const records = readLedger(root, "crash");
    const a2Starts = ofType(records, "attempt_start").filter((record) => record.attemptId === "a2");
    const a2Ends = ofType(records, "attempt_end").filter((record) => record.attemptId === "a2");
    expect(a2Starts.map((record) => record.try)).toEqual([1, 2]); // try1 = orphaned crash artifact
    expect(a2Ends.map((record) => record.try)).toEqual([2]); // only the re-run got a verdict
    expect(a2Ends[0].verdict).toBe("pass");
  }, 60_000);
});

describe("proofloop run -- graceful interrupt (Ctrl-C during an attempt)", () => {
  it("appends run_interrupted, exits 130, removes the lock, and resume continues without --clear-stale-lock", async () => {
    const root = tempRoot();
    const c1 = join(root, "c1.txt");
    const c2 = join(root, "c2.txt");
    const die = join(root, "die.marker");
    // a1 parks until the die-marker exists (so the interrupt lands mid-attempt);
    // after the interrupt the marker is present, so the re-run exits fast.
    const a1Wait = `if(!fs.existsSync('${fp(die)}')){const t=setInterval(()=>{if(fs.existsSync('${fp(die)}'))process.exit(0)},50);setTimeout(()=>process.exit(0),30000);}`;
    const planPath = writePlan(root, { budgetUsd: 10, attempts: [attempt("a1", counterCmd(c1, a1Wait)), attempt("a2", counterCmd(c2))] });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "sig", "--dir", root], root).status).toBe(0);

    // Drive the REAL executor in a subprocess and deliver SIGINT from inside
    // (process.emit runs the actual signal handler; Windows cannot deliver
    // external SIGINT to a background process, so this is the portable way to
    // exercise the graceful-death path for real).
    const driver = spawn(
      process.execPath,
      [
        "-e",
        `const {executeLongRun}=require('${fp(join(REPO_ROOT, "dist", "longrun.js"))}');` +
          `executeLongRun({root:'${fp(root)}',mode:'start',runId:'sig'});` +
          `const t=setInterval(()=>{if(require('fs').existsSync('${fp(c1)}')){clearInterval(t);setTimeout(()=>process.emit('SIGINT','SIGINT'),300);}},50);`,
      ],
      { cwd: root, stdio: "ignore" },
    );
    const exitCode = await new Promise<number | null>((resolveExit) => driver.on("exit", (code) => resolveExit(code)));
    writeFileSync(die, "die", "utf8"); // release any surviving a1 child
    expect(exitCode).toBe(130);

    const records = readLedger(root, "sig");
    const interrupted = ofType(records, "run_interrupted");
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].signal).toBe("SIGINT");
    expect(interrupted[0].inFlightAttemptIds).toEqual(["a1"]);
    expect(ofType(records, "attempt_end")).toHaveLength(0); // nothing finished before Ctrl-C
    // Graceful death releases the lock: resume needs NO --clear-stale-lock.
    expect(existsSync(join(root, ".proofloop", "longrun", "sig", "lock.json"))).toBe(false);
    const resume = runCliSync(["run", "resume", "--run", "sig", "--dir", root], root);
    expect(resume.status).toBe(0);
    expect(countExecutions(c1)).toBe(2); // in-flight at Ctrl-C -> re-ran
    expect(countExecutions(c2)).toBe(1);
  }, 60_000);
});

describe("proofloop run -- torn ledger tail (power cut mid-append)", () => {
  it("drops a torn final line, re-runs the attempt whose verdict was lost, and fails CLOSED on mid-file corruption", () => {
    const root = tempRoot();
    const c1 = join(root, "c1.txt");
    const c2 = join(root, "c2.txt");
    const planPath = writePlan(root, { budgetUsd: 10, attempts: [attempt("a1", counterCmd(c1)), attempt("a2", counterCmd(c2))] });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "torn", "--dir", root], root).status).toBe(0);
    expect(runCliSync(["run", "start", "--run", "torn", "--dir", root], root).status).toBe(0);

    // Simulate the crash shape: run_completed never landed, and a2's
    // attempt_end was torn mid-JSON by the power cut.
    const path = ledgerPath(root, "torn");
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
    expect(lines.at(-1)).toContain("run_completed");
    const kept = lines.slice(0, -1); // drop run_completed
    const tornEnd = kept.pop()!; // a2's attempt_end...
    expect(tornEnd).toContain('"attemptId":"a2"');
    writeFileSync(path, `${kept.join("\n")}\n${tornEnd.slice(0, Math.floor(tornEnd.length / 2))}`, "utf8"); // ...torn in half, no trailing newline

    const resume = runCliSync(["run", "resume", "--run", "torn", "--dir", root], root);
    expect(resume.status).toBe(0);
    expect(resume.stdout).toContain("torn final line");
    expect(countExecutions(c1)).toBe(1); // a1's verdict survived -- never re-run
    expect(countExecutions(c2)).toBe(2); // a2's verdict was lost -- re-ran
    const records = readLedger(root, "torn"); // final ledger parses cleanly again
    expect(ofType(records, "run_completed").length).toBeGreaterThanOrEqual(1);

    // Mid-file corruption is NOT recoverable-by-guessing: fail closed.
    const healthy = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
    healthy[1] = healthy[1].slice(0, 10); // corrupt a NON-final line
    writeFileSync(path, `${healthy.join("\n")}\n`, "utf8");
    const corrupt = runCliSync(["run", "resume", "--run", "torn", "--dir", root], root);
    expect(corrupt.status).toBe(2);
    expect(corrupt.stderr).toContain("corruption");
  });
});

describe("proofloop run -- budget enforcement (the $100 line)", () => {
  it("stops BEFORE the attempt that would cross the budget, records budget_exhausted, exits 3, and continues after a budget raise", () => {
    const root = tempRoot();
    const cA = join(root, "cA.txt");
    const cB = join(root, "cB.txt");
    const planPath = writePlan(root, {
      budgetUsd: 100,
      attempts: [attempt("A", counterCmd(cA), { estCostUsd: 60 }), attempt("B", counterCmd(cB), { estCostUsd: 60 })],
    });
    const init = runCliSync(["run", "init", "--plan", planPath, "--id", "budget", "--dir", root], root);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("WARNING: plan estimates"); // 120 > 100, said out loud at init

    const start = runCliSync(["run", "start", "--run", "budget", "--dir", root], root);
    expect(start.status).toBe(3); // distinct exit code: stopped at the budget line, not failed work
    expect(start.stderr).toContain("BUDGET EXHAUSTED");
    expect(countExecutions(cA)).toBe(1);
    expect(countExecutions(cB)).toBe(0); // B was refused, never silently attempted
    const records = readLedger(root, "budget");
    const exhausted = ofType(records, "budget_exhausted");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({ nextAttemptId: "B", nextTryEstCostUsd: 60, budgetUsd: 100 });
    expect(exhausted[0].spentUsd).toBeCloseTo(60, 6);
    expect(ofType(records, "run_completed")).toHaveLength(0); // no fake completion

    // Resume without more budget hits the same honest wall.
    expect(runCliSync(["run", "resume", "--run", "budget", "--dir", root], root).status).toBe(3);

    // The operator raises the budget in the run's plan copy, then resumes.
    const planCopy = join(root, ".proofloop", "longrun", "budget", "plan.json");
    const stored = JSON.parse(readFileSync(planCopy, "utf8"));
    stored.budgetUsd = 200;
    writeFileSync(planCopy, JSON.stringify(stored, null, 2), "utf8");
    const resumed = runCliSync(["run", "resume", "--run", "budget", "--dir", root], root);
    expect(resumed.status).toBe(0);
    expect(countExecutions(cA)).toBe(1); // A never re-billed
    expect(countExecutions(cB)).toBe(1);
  });
});

describe("proofloop run -- retries (flaky adapter, then a truly broken one)", () => {
  it("retries a failing attempt up to maxRetries with try numbers in the ledger; passes on recovery, exits 1 when exhausted", () => {
    const root = tempRoot();
    // Flaky: fails until the marker exists; its OWN first try creates the marker.
    const marker = join(root, "flaky.marker");
    const flakyCmd = [
      process.execPath,
      "-e",
      `const fs=require('fs');if(fs.existsSync('${fp(marker)}'))process.exit(0);fs.writeFileSync('${fp(marker)}','');process.exit(1);`,
    ];
    const flakyPlan = writePlan(root, { budgetUsd: 10, attempts: [attempt("flaky", flakyCmd)] });
    expect(runCliSync(["run", "init", "--plan", flakyPlan, "--id", "flaky", "--dir", root], root).status).toBe(0);
    const flakyRun = runCliSync(["run", "start", "--run", "flaky", "--dir", root], root);
    expect(flakyRun.status).toBe(0);
    const flakyEnds = ofType(readLedger(root, "flaky"), "attempt_end");
    expect(flakyEnds.map((end) => [end.try, end.verdict])).toEqual([
      [1, "fail"],
      [2, "pass"],
    ]);

    // Broken: always exits 1; maxRetries 1 => exactly 2 tries, then terminal fail.
    const cBroken = join(root, "cBroken.txt");
    const brokenPlan = writePlan(root, {
      budgetUsd: 10,
      maxRetries: 1,
      attempts: [attempt("broken", counterCmd(cBroken, "process.exit(1);"))],
    });
    expect(runCliSync(["run", "init", "--plan", brokenPlan, "--id", "broken", "--dir", root], root).status).toBe(0);
    const brokenRun = runCliSync(["run", "start", "--run", "broken", "--dir", root], root);
    expect(brokenRun.status).toBe(1); // completed WITH failures -- never disguised as success
    expect(countExecutions(cBroken)).toBe(2);
    const brokenEnds = ofType(readLedger(root, "broken"), "attempt_end");
    expect(brokenEnds.map((end) => end.verdict)).toEqual(["fail", "fail"]);
    // Idempotent resume on a failed-terminal run keeps reporting failure honestly.
    const resumeBroken = runCliSync(["run", "resume", "--run", "broken", "--dir", root], root);
    expect(resumeBroken.status).toBe(1);
    expect(countExecutions(cBroken)).toBe(2); // retries exhausted -- no zombie re-runs
  });
});

describe("proofloop run -- single-flight lock (two runners must never double-spend)", () => {
  it("reports a dead-pid lock as stale, requires --clear-stale-lock to proceed, and refuses a LIVE lock even with the flag", async () => {
    const root = tempRoot();
    const c1 = join(root, "c1.txt");
    const planPath = writePlan(root, { budgetUsd: 10, attempts: [attempt("a1", counterCmd(c1))] });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "locky", "--dir", root], root).status).toBe(0);
    const lockPath = join(root, ".proofloop", "longrun", "locky", "lock.json");

    // A genuinely dead pid: spawn a child that exits immediately, keep its pid.
    const ghost = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const ghostPid = ghost.pid!;
    await new Promise<void>((resolveExit) => ghost.on("exit", () => resolveExit()));
    const writeLock = (pid: number) =>
      writeFileSync(
        lockPath,
        JSON.stringify({ schema: "proofloop-longrun-lock-v1", pid, host: require("node:os").hostname(), startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }),
        "utf8",
      );

    writeLock(ghostPid);
    const status = runCliSync(["run", "status", "--run", "locky", "--dir", root], root);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("STALE");
    expect(status.stdout).toContain("dead");
    expect(runCliSync(["run", "start", "--run", "locky", "--dir", root], root).status).toBe(2); // refuses without the flag
    const cleared = runCliSync(["run", "start", "--run", "locky", "--dir", root, "--clear-stale-lock"], root);
    expect(cleared.status).toBe(0);
    expect(countExecutions(c1)).toBe(1);

    // LIVE lock (this vitest process's pid, fresh heartbeat): nothing may proceed.
    const root2 = tempRoot();
    const c2 = join(root2, "c2.txt");
    const plan2 = writePlan(root2, { budgetUsd: 10, attempts: [attempt("a1", counterCmd(c2))] });
    expect(runCliSync(["run", "init", "--plan", plan2, "--id", "live", "--dir", root2], root2).status).toBe(0);
    writeFileSync(
      join(root2, ".proofloop", "longrun", "live", "lock.json"),
      JSON.stringify({ schema: "proofloop-longrun-lock-v1", pid: process.pid, host: require("node:os").hostname(), startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }),
      "utf8",
    );
    const refused = runCliSync(["run", "start", "--run", "live", "--dir", root2], root2);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("live runner");
    // --clear-stale-lock clears STALE locks only; a live lock still refuses.
    expect(runCliSync(["run", "start", "--run", "live", "--dir", root2, "--clear-stale-lock"], root2).status).toBe(2);
    expect(countExecutions(c2)).toBe(0);
  });
});

describe("proofloop run -- secret redaction (keys live in env, never in the ledger)", () => {
  it("redacts sk-style tokens, KEY=value assignments, and echoed secret env values from captured output", () => {
    const root = tempRoot();
    // The token is CONSTRUCTED at runtime (concatenation): a literal token in
    // the plan would be rejected by init's fail-closed validation -- which is
    // the point. Real leaks come from runtime values (echoed env, API errors).
    const leakyCmd = [
      process.execPath,
      "-e",
      `console.log('auth with '+['sk','test','12345'].join('-')+' ok');console.error('OPENROUTER_API_KEY='+process.env.OPENROUTER_API_KEY);console.error('plain text stays');`,
    ];
    const planPath = writePlan(root, { budgetUsd: 10, attempts: [attempt("leaky", leakyCmd)] });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "leaky", "--dir", root], root).status).toBe(0);
    const run = runCliSync(["run", "start", "--run", "leaky", "--dir", root], root, {
      OPENROUTER_API_KEY: "supersecretvalue123",
    });
    expect(run.status).toBe(0);

    const raw = readFileSync(ledgerPath(root, "leaky"), "utf8");
    expect(raw).toContain("[redacted]");
    expect(raw).not.toContain("sk-test-12345"); // token-shape redaction
    expect(raw).not.toContain("supersecretvalue123"); // env-value redaction
    expect(raw).toContain("plain text stays"); // non-secret output is preserved
    const end = ofType(readLedger(root, "leaky"), "attempt_end")[0];
    expect(end.stdoutTail).toContain("[redacted]");
    expect(end.stderrTail).toContain("OPENROUTER_API_KEY=[redacted]");
  });

  it("REJECTS a plan that embeds a secret-looking token (fail-closed at init)", () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      budgetUsd: 10,
      attempts: [attempt("bad", [process.execPath, "-e", "0", "--api-key", "sk-or-v1-abcdef1234567890"])],
    });
    const init = runCliSync(["run", "init", "--plan", planPath, "--dir", root], root);
    expect(init.status).toBe(2);
    expect(init.stderr).toContain("secret-looking token");
    expect(existsSync(join(root, ".proofloop", "longrun"))).toBe(false); // nothing half-created
  });
});

describe("proofloop run init -- fail-closed plan validation (sloppy plan author)", () => {
  it("rejects unknown keys, duplicate ids, missing fields, non-argv commands, and an existing run id", () => {
    const root = tempRoot();
    const cases: { plan: Record<string, unknown>; expectError: string }[] = [
      { plan: { budgetUsd: 10, atempts: [] }, expectError: 'unknown key "atempts"' },
      { plan: { budgetUsd: 10, attempts: [attempt("a", counterCmd(join(root, "x")), { verdict: "pass" })] }, expectError: 'unknown key "verdict"' },
      {
        plan: { budgetUsd: 10, attempts: [attempt("dup", counterCmd(join(root, "x"))), attempt("dup", counterCmd(join(root, "y")))] },
        expectError: "duplicate id",
      },
      { plan: { budgetUsd: 10, attempts: [{ id: "a", family: "f", taskId: "t", model: "m", timeoutMs: 1000, estCostUsd: 0 }] }, expectError: "command" },
      { plan: { budgetUsd: 10, attempts: [attempt("a", "node -e 0" as unknown as string[])] }, expectError: "argv array" },
      { plan: { budgetUsd: 10, attempts: [attempt("a", counterCmd(join(root, "x")), { estCostUsd: -1 })] }, expectError: "estCostUsd" },
      { plan: { budgetUsd: 10, attempts: [] }, expectError: "non-empty array" },
      { plan: { budgetUsd: 10, concurrency: 99, attempts: [attempt("a", counterCmd(join(root, "x")))] }, expectError: "concurrency" },
    ];
    for (const { plan, expectError } of cases) {
      const planPath = writePlan(root, plan);
      const init = runCliSync(["run", "init", "--plan", planPath, "--dir", root], root);
      expect(init.status, `expected rejection for: ${expectError}`).toBe(2);
      expect(init.stderr).toContain(expectError);
    }

    // A valid init, then the same id again: refuse to clobber an existing ledger.
    const good = writePlan(root, { budgetUsd: 10, attempts: [attempt("a", counterCmd(join(root, "c.txt")))] });
    expect(runCliSync(["run", "init", "--plan", good, "--id", "same", "--dir", root], root).status).toBe(0);
    const again = runCliSync(["run", "init", "--plan", good, "--id", "same", "--dir", root], root);
    expect(again.status).toBe(2);
    expect(again.stderr).toContain("already exists");
  });
});

describe("proofloop run -- concurrency (pool of 2, budget still safe)", () => {
  it("overlaps attempts up to plan.concurrency while keeping the ledger and verdicts consistent", () => {
    const root = tempRoot();
    const counters = [1, 2, 3, 4].map((i) => join(root, `c${i}.txt`));
    const sleepy = (file: string) => counterCmd(file, "setTimeout(()=>process.exit(0),700);");
    const planPath = writePlan(root, {
      budgetUsd: 10,
      concurrency: 2,
      attempts: counters.map((file, i) => attempt(`p${i + 1}`, sleepy(file))),
    });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "pool", "--dir", root], root).status).toBe(0);
    const run = runCliSync(["run", "start", "--run", "pool", "--dir", root], root);
    expect(run.status).toBe(0);
    expect(counters.map(countExecutions)).toEqual([1, 1, 1, 1]);

    const records = readLedger(root, "pool");
    const ends = ofType(records, "attempt_end");
    expect(ends).toHaveLength(4);
    expect(ends.every((end) => end.verdict === "pass")).toBe(true);
    // Proof of overlap: p2 STARTED before p1 ENDED (700ms sleeps, pool of 2).
    const indexOf = (predicate: (record: LongRunLedgerRecord) => boolean) => records.findIndex(predicate);
    const p2Start = indexOf((record) => record.type === "attempt_start" && record.attemptId === "p2");
    const p1End = indexOf((record) => record.type === "attempt_end" && record.attemptId === "p1");
    expect(p2Start).toBeGreaterThan(-1);
    expect(p1End).toBeGreaterThan(-1);
    expect(p2Start).toBeLessThan(p1End);
  });
});

describe("proofloop run -- timeout verdict", () => {
  it("kills an attempt that exceeds its timeoutMs and records verdict=timeout (then retries honestly)", () => {
    const root = tempRoot();
    const planPath = writePlan(root, {
      budgetUsd: 10,
      maxRetries: 0,
      attempts: [attempt("slow", [process.execPath, "-e", "setTimeout(()=>process.exit(0),30000);"], { timeoutMs: 1_000 })],
    });
    expect(runCliSync(["run", "init", "--plan", planPath, "--id", "slow", "--dir", root], root).status).toBe(0);
    const run = runCliSync(["run", "start", "--run", "slow", "--dir", root], root);
    expect(run.status).toBe(1); // terminal failure (maxRetries 0), reported as such
    const ends = ofType(readLedger(root, "slow"), "attempt_end");
    expect(ends).toHaveLength(1);
    expect(ends[0].verdict).toBe("timeout");
  });
});

describe("proofloop run -- command registration honesty", () => {
  it("registers `run` in PACKAGE_COMMANDS (the grep-asserted honesty list) and in --help", () => {
    expect(PACKAGE_COMMANDS).toContain("run");
    const help = runCliSync(["help"], REPO_ROOT);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("run init --plan");
    expect(help.stdout).toContain("run start|resume");
  });
});
