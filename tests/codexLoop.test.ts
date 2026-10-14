import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import { runProofloopAgentLoop } from "../src/agentLoop";

const tempRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Codex repair loop", () => {
  it("turns a failed gate into Codex relaunch and repair-prompt artifacts", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "proofloop.config.json"), JSON.stringify({
      app: "generic web app",
      workflow: "test",
      gate: { checks: [{ name: "boom", command: nodeCommand("process.exit(7)") }] },
      immutable: [],
    }, null, 2), "utf8");

    const result = await runProofloopAgentLoop({
      root,
      runId: "loop-test",
      dryRun: true,
      log: () => {},
      logError: () => {},
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.attempts).toBe(0);
    expect(existsSync(join(root, ".proofloop", "runs", "loop-test", "codex-relaunch.json"))).toBe(true);
    expect(readFileSync(join(root, ".proofloop", "runs", "loop-test", "codex-reprompt.md"), "utf8")).toContain("Codex Proof Loop Repair Prompt");

    await expect(Promise.resolve(runCli(["--dir", root, "codex", "reprompt", "loop-test"]))).resolves.toBe(0);
  });

  it("exposes agent setup and provider setup through the CLI", async () => {
    const root = tempRoot();

    await expect(Promise.resolve(runCli(["--dir", root, "agents", "setup", "codex", "--local"]))).resolves.toBe(0);
    expect(existsSync(join(root, ".codex", "hooks.local.json"))).toBe(true);

    await expect(Promise.resolve(runCli(["--dir", root, "providers", "setup", "nebius", "--json"]))).resolves.toBe(1);
    expect(existsSync(join(root, ".proofloop", "setup", "providers", "nebius.json"))).toBe(true);
  });
});

describe("a developer's bounded project repair", () => {
  it.each([
    { name: "the default final repair", maxAttempts: undefined, fixAfter: 1 },
    { name: "the last of two repairs", maxAttempts: 2, fixAfter: 2 },
    { name: "an early repair with budget remaining", maxAttempts: 3, fixAfter: 1 },
  ])("verifies $name before reporting success", async ({ maxAttempts, fixAfter }) => {
    const root = repairProject({ fixAfter });
    const result = await repair(root, { maxAttempts });
    expect(result).toMatchObject({ passed: true, exitCode: 0, attempts: fixAfter });
    expect(projectState(root).repairs).toBe(fixAfter);
    expectGateHistory(result.runDir, [...Array(fixAfter).fill("failed"), "passed"]);
    expect(readJson(join(root, ".proofloop", "gate-state.json"))).toEqual(
      readJson(join(result.runDir, `gate-attempt-${fixAfter + 1}.json`)),
    );
    const events = readFileSync(join(root, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.kind)).toEqual([
      ...Array.from({ length: fixAfter }, () => ["api", "export", "repair"]).flat(), "api", "export",
    ]);
    for (let attempt = 1; attempt <= fixAfter; attempt++) {
      expect(readFileSync(join(result.runDir, `generic-cli-repair-prompt-${attempt}.md`), "utf8"))
        .toContain(`Loop attempt: ${attempt}/${maxAttempts ?? 1}`);
    }
  });

  it("does not launch a repair when the project's checks already pass", async () => {
    const root = repairProject();
    writeProjectState(root, { repairs: 0, api: true, export: true });
    const result = await repair(root);
    expect(result).toMatchObject({ passed: true, exitCode: 0, attempts: 0 });
    expect(projectState(root).repairs).toBe(0);
    expectGateHistory(result.runDir, ["passed"]);
    expect(readdirSync(result.runDir)).toEqual(["gate-attempt-1.json"]);
  });

  it.each([
    { name: "an agent that only claims success", fixAfter: 99, partial: false, failedChecks: ["api", "export"] },
    { name: "an agent that repairs only the API", fixAfter: 1, partial: true, failedChecks: ["export"] },
  ])("keeps failure honest for $name without exceeding the budget", async ({ fixAfter, partial, failedChecks }) => {
    const root = repairProject({ fixAfter, partial });
    const result = await repair(root, { maxAttempts: 2 });
    expect(result).toMatchObject({ passed: false, exitCode: 1, attempts: 2 });
    expect(projectState(root).repairs).toBe(2);
    expectGateHistory(result.runDir, ["failed", "failed", "failed"]);
    const lastGate = readJson(join(result.runDir, "gate-attempt-3.json"));
    expect(lastGate.checks.filter((check: { pass: boolean }) => !check.pass).map((check: { name: string }) => check.name))
      .toEqual(failedChecks);
    expect(existsSync(join(result.runDir, "generic-cli-repair-prompt-3.md"))).toBe(false);
  });

  it("stops on a failed launched process even when that process changed the project", async () => {
    const root = repairProject({ agentExit: 7 });
    const result = await repair(root, { maxAttempts: 3 });
    expect(result).toMatchObject({ passed: false, exitCode: 1, attempts: 1 });
    expect(projectState(root)).toEqual({ repairs: 1, api: true, export: true });
    expectGateHistory(result.runDir, ["failed"]);
    expect(readJson(join(result.runDir, "generic-cli-repair-attempt.json")).runResult)
      .toMatchObject({ launched: true, status: "failed", exitCode: 7 });
  });

  it.each(["dry-run", "missing-command"])("leaves an actionable prompt but counts no launch for %s", async (mode) => {
    const root = repairProject();
    vi.stubEnv("PROOFLOOP_GENERIC_AGENT_COMMAND", "");
    const result = await repair(root, mode === "dry-run" ? { dryRun: true } : { command: undefined });
    expect(result).toMatchObject({ passed: false, exitCode: 1, attempts: 0 });
    expect(projectState(root).repairs).toBe(0);
    expectGateHistory(result.runDir, ["failed"]);
    expect(readFileSync(result.repairPromptPath!, "utf8")).toContain("api");
  });

  it("does not manufacture a pass when no gate is configured", async () => {
    const root = repairProject();
    rmSync(join(root, "proofloop.config.json"));
    const result = await repair(root);
    expect(result).toMatchObject({ passed: false, exitCode: 2, attempts: 1 });
    expect(projectState(root).repairs).toBe(1);
    expectGateHistory(result.runDir, ["no_gate", "no_gate"]);
  });

  it("rejects malformed API budgets before creating receipts or executing project checks", async () => {
    for (const maxAttempts of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const root = repairProject();
      await expect(repair(root, { maxAttempts })).rejects.toThrow("maxAttempts must be a positive safe integer");
      expect(existsSync(join(root, ".proofloop"))).toBe(false);
      expect(existsSync(join(root, "events.jsonl"))).toBe(false);
    }
  });

  it("rejects malformed CLI budgets instead of silently substituting one attempt", async () => {
    for (const flag of ["--max-attempts", "--max-attempts=", "--max-attempts=wat", "--max-attempts=NaN",
      "--max-attempts=Infinity", "--max-attempts=0", "--max-attempts=-1", "--max-attempts=1.5",
      "--max-attempts=9007199254740992"]) {
      const root = repairProject();
      expect(await runCli(["--dir", root, "codex-loop", "--dry-run", flag])).toBe(2);
      expect(existsSync(join(root, ".proofloop"))).toBe(false);
      expect(existsSync(join(root, "events.jsonl"))).toBe(false);
    }
  });

  it("keeps three simultaneous CLI jobs isolated and checks each final repair", async () => {
    const roots = [repairProject(), repairProject({ fixAfter: 2 }), repairProject({ partial: true })];
    const results = await Promise.all(roots.map((root) => runLoopCli(root)));
    expect(results.map((result) => result.code)).toEqual([0, 0, 1]);
    expect(results[0].output).toContain("passed run=cli-burst attempts=1");
    expect(results[1].output).toContain("passed run=cli-burst attempts=2");
    expect(results[2].output).toContain("needs-repair run=cli-burst attempts=2");
    roots.forEach((root, index) => {
      expect(projectState(root).repairs).toBe(index === 0 ? 1 : 2);
      expectGateHistory(join(root, ".proofloop", "runs", "cli-burst"),
        index === 0 ? ["failed", "passed"] : index === 1 ? ["failed", "failed", "passed"] : ["failed", "failed", "failed"]);
    });
  });

  it("verifies twelve successive jobs without reusing a previous job's passing state", async () => {
    const root = repairProject();
    const snapshots: Array<{ path: string; contents: string }> = [];
    for (let job = 0; job < 12; job++) {
      writeProjectState(root, { repairs: 0, api: false, export: false });
      const result = await repair(root, { runId: `sustained-${job}` });
      expect(result).toMatchObject({ passed: true, exitCode: 0, attempts: 1 });
      expectGateHistory(result.runDir, ["failed", "passed"]);
      const path = join(result.runDir, "gate-attempt-2.json");
      snapshots.push({ path, contents: readFileSync(path, "utf8") });
    }
    expect(readdirSync(join(root, ".proofloop", "runs"))).toHaveLength(12);
    for (const snapshot of snapshots) expect(readFileSync(snapshot.path, "utf8")).toBe(snapshot.contents);
  });
});

function repairProject({ fixAfter = 1, partial = false, agentExit = 0 } = {}): string {
  const root = tempRoot();
  writeProjectState(root, { repairs: 0, api: false, export: false });
  writeFileSync(join(root, "check.cjs"), `
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync('project.json', 'utf8'));
const name = process.argv[2];
fs.appendFileSync('events.jsonl', JSON.stringify({ kind: name, pass: state[name] }) + '\\n');
process.exit(state[name] ? 0 : 7);
`);
  writeFileSync(join(root, "repair.cjs"), `
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync('project.json', 'utf8'));
state.repairs++;
if (state.repairs >= ${fixAfter}) { state.api = true; state.export = ${!partial}; }
fs.writeFileSync('project.json', JSON.stringify(state));
fs.appendFileSync('events.jsonl', JSON.stringify({ kind: 'repair', count: state.repairs }) + '\\n');
console.log('Agent claims the project is fixed');
process.exit(${agentExit});
`);
  writeFileSync(join(root, "proofloop.config.json"), JSON.stringify({
    app: "API and export project", workflow: "repair both deliverables", immutable: [],
    gate: { checks: ["api", "export"].map((name) => ({ name, command: `"${process.execPath}" check.cjs ${name}` })) },
  }));
  return root;
}

function repair(root: string, options: Partial<Parameters<typeof runProofloopAgentLoop>[0]> = {}) {
  return runProofloopAgentLoop({ root, agentId: "generic-cli", runId: "project-repair",
    command: `"${process.execPath}" repair.cjs`, log: () => {}, logError: () => {}, ...options });
}

function expectGateHistory(runDir: string, statuses: string[]) {
  const snapshots = readdirSync(runDir).filter((name) => name.startsWith("gate-attempt-"));
  expect(snapshots).toHaveLength(statuses.length);
  expect(statuses.map((_, index) => readJson(join(runDir, `gate-attempt-${index + 1}.json`)).status)).toEqual(statuses);
}

function readJson(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function projectState(root: string) { return readJson(join(root, "project.json")); }
function writeProjectState(root: string, state: { repairs: number; api: boolean; export: boolean }) {
  writeFileSync(join(root, "project.json"), JSON.stringify(state));
}

function runLoopCli(root: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "cli.js"), "--dir", root,
      "codex-loop", "--agent", "generic-cli", "--command", `"${process.execPath}" repair.cjs`,
      "--run-id", "cli-burst", "--max-attempts", "2"], { timeout: 30_000 });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-codex-loop-"));
  tempRoots.push(root);
  return root;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

describe("a developer's elapsed-time repair budget", () => {
  it("writes a timeout receipt and stops before another repair or verification", async () => {
    const root = deadlineProject();
    const result = await repair(root, { maxAttempts: 3, timeoutMs: 350 });
    expect(result).toMatchObject({ passed: false, exitCode: 1, attempts: 1 });
    expectGateHistory(result.runDir, ["failed"]);
    const receipt = readJson(join(result.runDir, "generic-cli-repair-attempt.json"));
    expect(receipt.runResult).toMatchObject({ status: "failed", launched: true });
    expect(receipt.runResult.message).toContain("timed out");
    expect(existsSync(join(root, "expired"))).toBe(false);
    expect(projectState(root).repairs).toBe(1);
    expect(existsSync(join(result.runDir, "generic-cli-repair-prompt-2.md"))).toBe(false);
  });

  it("rejects invalid API and CLI deadlines before gates or receipts", async () => {
    const root = repairProject();
    for (const timeoutMs of [0, -1, 1.1, NaN, Infinity, 2147483648]) {
      await expect(repair(root, { timeoutMs })).rejects.toThrow("timeoutMs must be an integer");
    }
    for (const value of ["", "wat", "0", "-1", "1.1", "Infinity", "2147483648"]) {
      expect(await runCli(["--dir", root, "codex-loop", `--timeout-ms=${value}`])).toBe(2);
      expect(await runCli(["--dir", root, "codex", "relaunch", "not-created", `--timeout-ms=${value}`])).toBe(2);
    }
    expect(await runCli(["--dir", root, "codex-loop", "--timeout-ms"])).toBe(2);
    expect(existsSync(join(root, "events.jsonl"))).toBe(false);
    expect(existsSync(join(root, ".proofloop"))).toBe(false);
  });

  it("does no work for a pre-aborted project and stops after a cancelled active repair", async () => {
    const root = deadlineProject();
    const pre = new AbortController(); pre.abort();
    expect(await repair(root, { signal: pre.signal })).toMatchObject({ attempts: 0, passed: false });
    expect(existsSync(join(root, ".proofloop"))).toBe(false);
    const controller = new AbortController();
    const pending = repair(root, { signal: controller.signal, timeoutMs: 2000, maxAttempts: 3 });
    await waitForFile(join(root, "ready"));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ attempts: 1, passed: false });
    expectGateHistory(result.runDir, ["failed"]);
    expect(readJson(join(result.runDir, "generic-cli-repair-attempt.json")).runResult.message).toContain("cancelled");
  });

  it("awaits a bounded direct Codex relaunch supplied with an explicit local command", async () => {
    const root = deadlineProject();
    const runDir = join(root, ".proofloop", "runs", "direct");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "codex-reprompt.md"), "Repair the local project; do not weaken its checks.");
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const before = signals.map(s => process.listenerCount(s));
    const started = Date.now();
    try {
      expect(await runCli(["--dir", root, "codex", "relaunch", "direct", "--command", `"${process.execPath}" repair.cjs`, "--timeout-ms", "350"])).toBe(1);
      expect(existsSync(join(runDir, "codex-stdout.log"))).toBe(true);
      const beats = readFileSync(join(root, "beats"), "utf8");
      await new Promise(r => setTimeout(r, 300));
      expect(readFileSync(join(root, "beats"), "utf8")).toBe(beats);
      expect(existsSync(join(root, "expired"))).toBe(false);
      expect(signals.map(s => process.listenerCount(s))).toEqual(before);
    } finally {
      // On a failed cleanup assertion the finite fixture must expire before the existing temp-root teardown.
      await new Promise(r => setTimeout(r, Math.max(0, 6500 - (Date.now() - started))));
    }
  }, 10000);

  it("keeps a three-job CLI burst isolated across success, timeout and partial repair", async () => {
    const roots = [repairProject(), deadlineProject(), repairProject({ partial: true })];
    const results = await Promise.all(roots.map((root, i) => runDeadlineCli(root, `deadline-burst-${i}`)));
    expect(results.map(r => r.code)).toEqual([0, 1, 1]);
    expect(results[0].output).toContain("attempts=1");
    expect(results[1].output).toContain("attempts=1");
    expect(results[2].output).toContain("attempts=2");
    expectGateHistory(join(roots[1], ".proofloop/runs/deadline-burst-1"), ["failed"]);
    const beats = readFileSync(join(roots[1], "beats"), "utf8");
    await new Promise(r => setTimeout(r, 200));
    expect(readFileSync(join(roots[1], "beats"), "utf8")).toBe(beats);
  }, 15000);

  it("finishes twelve successive CLI jobs with separate receipts and no continued timed-out heartbeat", async () => {
    const snapshots: Array<{ file: string; text: string }> = [];
    for (let i = 0; i < 12; i++) {
      const slow = i % 2 === 1, root = slow ? deadlineProject() : repairProject(), id = `deadline-sustained-${i}`;
      const result = await runDeadlineCli(root, id);
      expect(result.code).toBe(slow ? 1 : 0);
      expect(result.output).toContain("attempts=1");
      const dir = join(root, ".proofloop/runs", id);
      expectGateHistory(dir, slow ? ["failed"] : ["failed", "passed"]);
      const file = join(dir, "generic-cli-repair-attempt.json");
      snapshots.push({ file, text: readFileSync(file, "utf8") });
      if (slow) {
        const beats = readFileSync(join(root, "beats"), "utf8");
        await new Promise(r => setTimeout(r, 150));
        expect(readFileSync(join(root, "beats"), "utf8")).toBe(beats);
        expect(existsSync(join(root, "expired"))).toBe(false);
      }
    }
    for (const s of snapshots) expect(readFileSync(s.file, "utf8")).toBe(s.text);
  }, 45000);

  it.skipIf(process.platform === "win32")("forwards a real CLI interrupt to its active POSIX repair and writes the failure receipt", async () => {
    const root = deadlineProject(), id = "interrupt";
    const child = spawn(process.execPath, [join(process.cwd(), "dist/cli.js"), "--dir", root, "codex-loop", "--agent", "generic-cli", "--command", `"${process.execPath}" repair.cjs`, "--run-id", id, "--timeout-ms", "3000"], { stdio: "ignore", timeout: 10000 });
    const closed = new Promise(resolve => child.once("close", code => resolve(code)));
    await waitForFile(join(root, "ready")); child.kill("SIGINT");
    expect(await closed).toBe(1);
    expect(readJson(join(root, ".proofloop/runs", id, "generic-cli-repair-attempt.json")).runResult.message).toContain("cancelled");
    expectGateHistory(join(root, ".proofloop/runs", id), ["failed"]);
  }, 15000);
});

function deadlineProject(): string {
  const root = repairProject();
  writeFileSync(join(root, "repair.cjs"), `const fs=require('node:fs');const prompt=fs.readFileSync(0,'utf8');if(prompt!==fs.readFileSync(process.env.PROOFLOOP_REPAIR_PROMPT,'utf8'))throw Error('prompt mismatch');const state=JSON.parse(fs.readFileSync('project.json'));state.repairs++;fs.writeFileSync('project.json',JSON.stringify(state));fs.writeFileSync('ready','yes');const t=setInterval(()=>fs.appendFileSync('beats','.'),50);setTimeout(()=>{clearInterval(t);fs.writeFileSync('expired','yes');process.exitCode=7;},6000);`);
  return root;
}
async function waitForFile(file: string): Promise<void> {
  const end = Date.now() + 2500;
  while (!existsSync(file) && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  expect(existsSync(file)).toBe(true);
}
function runDeadlineCli(root: string, id: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "dist/cli.js"), "--dir", root, "codex-loop", "--agent", "generic-cli", "--command", `"${process.execPath}" repair.cjs`, "--run-id", id, "--max-attempts", "2", "--timeout-ms", "500"], { timeout: 12000, windowsHide: true });
    let output = "";
    child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
    child.once("error", reject); child.once("close", code => resolve({ code, output }));
  });
}
