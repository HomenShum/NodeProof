import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentRepairPrompt,
  getProofloopAgentAdapter,
  launchProofloopAgentAdapter,
  setupProofloopAgentAdapter,
  writeAgentRepairAttemptReceipt,
  type AgentRunResult,
  type ProofloopVerdict,
} from "../src/agentAdapters";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop agent adapters", () => {
  const verdict: ProofloopVerdict = {
    runId: "gate-001",
    suite: "proofloop-gate",
    cmd: "npx proofloop gate",
    passed: false,
    exitCode: 1,
    failedGates: ["build"],
    receiptPaths: [".proofloop/gate-state.json"],
  };

  it("sets up Codex hooks and writes an agent adapter receipt", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "codex",
      root,
      local: true,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      schema: "proofloop-agent-adapter-setup-v1",
      adapterId: "codex",
      status: "ready",
      hookHost: "codex",
    });
    expect(existsSync(join(root, ".codex", "hooks.local.json"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "setup", "agents", "codex.json"))).toBe(true);
  });

  it("records adapter work still needed for Cursor/Windsurf/Devin-style hosts", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "cursor",
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt.status).toBe("needs_adapter");
    expect(receipt.gateEnforcement.join(" ")).toContain("adapter-required");
    expect(readFileSync(join(root, ".proofloop", "setup", "agents", "cursor.json"), "utf8")).toContain("launch/trace/gate");
  });

  it("builds generic repair prompts and attempt receipts", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", verdict.runId);
    const promptPath = join(runDir, "generic-cli-repair-prompt.md");
    const prompt = buildAgentRepairPrompt({
      adapterId: "generic-cli",
      verdict,
      repairPrompt: "Build failed in the deterministic gate.",
      attempt: 1,
      maxAttempts: 2,
    });
    expect(prompt).toContain("Adapter: generic-cli");
    expect(prompt).toContain("Do not weaken verifiers");
    expect(prompt).toContain("build");

    const runResult: AgentRunResult = {
      adapterId: "generic-cli",
      status: "needs_command",
      launched: false,
      promptPath: ".proofloop/runs/gate-001/generic-cli-repair-prompt.md",
      message: "dry run",
    };
    const receiptPath = writeAgentRepairAttemptReceipt({
      root,
      runDir,
      adapterId: "generic-cli",
      meta: verdict,
      repairPromptPath: promptPath,
      attempt: 1,
      maxAttempts: 2,
      runResult,
    });
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
      schema: "proofloop-agent-repair-attempt-v1",
      adapterId: "generic-cli",
      failedRunId: verdict.runId,
      runResult: { status: "needs_command" },
    });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-agent-adapter-"));
  tempRoots.push(root);
  return root;
}

describe("a developer waiting for a repair deadline", () => {
  it("lets the caller run while a real repair is active, then ends it before its own expiry", async () => {
    const root = tempRoot();
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "Repair the two local checks without weakening them.");
    writeFileSync(join(root, "slow.cjs"), `
const fs=require('node:fs');
if(fs.readFileSync(0,'utf8')!==fs.readFileSync(process.env.PROOFLOOP_REPAIR_PROMPT,'utf8'))throw Error('prompt mismatch');
fs.writeFileSync('ready','yes');
const timer=setInterval(()=>fs.appendFileSync('beats','.'),100);
setTimeout(()=>{clearInterval(timer);fs.writeFileSync('expired','yes');process.exitCode=7;},4000);
`);
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 100);
    const started = Date.now();
    const pending = getProofloopAgentAdapter("generic-cli").launch(promptPath, root, {
      command: `"${process.execPath}" slow.cjs`, timeoutMs: 500,
    });
    const returnedAfter = Date.now() - started;
    const result = await pending;
    clearTimeout(timer);
    expect(returnedAfter).toBeLessThan(300);
    expect(timerRan).toBe(true);
    expect(result).toMatchObject({ launched: true, status: "failed" });
    expect(result.message).toContain("timed out");
    expect(existsSync(join(root, "ready"))).toBe(true);
    expect(existsSync(join(root, "expired"))).toBe(false);
    const beats = readFileSync(join(root, "beats"), "utf8");
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(readFileSync(join(root, "beats"), "utf8")).toBe(beats);
    expect(Date.now() - started).toBeLessThan(3500);
  }, 10000);
});

describe("a developer's interrupted or degraded local repair", () => {
  it("cancels an ordinary descendant tree without leaving its heartbeat active", async () => {
    const root = agentFixture(`
const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',"const fs=require('node:fs');const t=setInterval(()=>fs.appendFileSync('descendant-beats','.'),50);setTimeout(()=>{clearInterval(t);fs.writeFileSync('descendant-expired','yes');},6000)"],{stdio:['ignore','inherit','inherit']});
fs.writeFileSync('ready','yes');setTimeout(()=>{},6000);
`);
    const controller = new AbortController();
    const pending = launch(root, { timeoutMs: 3000, signal: controller.signal });
    await until(() => existsSync(join(root, "descendant-beats")));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: "failed", launched: true });
    expect(result.message).toContain("cancelled");
    expect(result.message).not.toContain("cleanup-unverified");
    const beats = readFileSync(join(root, "descendant-beats"), "utf8");
    await wait(300);
    expect(readFileSync(join(root, "descendant-beats"), "utf8")).toBe(beats);
    expect(existsSync(join(root, "descendant-expired"))).toBe(false);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  }, 10000);

  it("never turns cancellation into success when the repair was about to exit zero", async () => {
    const root = agentFixture("fs.writeFileSync('ready','yes');setTimeout(()=>{},300);");
    const controller = new AbortController();
    const pending = launch(root, { signal: controller.signal, timeoutMs: 2000 });
    await until(() => existsSync(join(root, "ready")));
    controller.abort();
    expect(await pending).toMatchObject({ status: "failed", launched: true, exitCode: 1 });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("rejects malformed deadlines and pre-abort before reading a prompt or launching", async () => {
    const root = tempRoot();
    for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
      await expect(launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: root, promptPath: join(root, "missing"), timeoutMs, command: "must-not-run" }))
        .rejects.toThrow("timeoutMs must be an integer");
    }
    const controller = new AbortController(); controller.abort();
    const result = await launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: root, promptPath: join(root, "missing"), signal: controller.signal, command: "must-not-run" });
    expect(result).toMatchObject({ launched: false, status: "failed" });
    expect(result.message).toContain("before launch");
    expect(existsSync(join(root, "generic-cli-stdout.log"))).toBe(false);
  });

  it("reports missing input and an OS launch failure without counting a launch", async () => {
    const root = agentFixture("console.log('done');");
    const missing = await launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: root, promptPath: join(root, "missing"), command: "unused" });
    expect(missing).toMatchObject({ launched: false, status: "failed" });
    expect(missing.message).toContain("Cannot read repair prompt");
    const result = await launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: join(root, "missing-dir"), promptPath: join(root, "prompt.md"), command: `"${process.execPath}" repair.cjs`, timeoutMs: 500 });
    expect(result).toMatchObject({ launched: false, status: "failed" });
    expect(result.message).toContain("launch failed");
  });

  it.each(["stdout", "stderr"] as const)("bounds %s when a local repair floods output", async stream => {
    const root = agentFixture(`process.${stream}.write(Buffer.alloc(1048576+8192,120));setTimeout(()=>{},1000);`);
    const result = await launch(root, { timeoutMs: 2000 });
    expect(result).toMatchObject({ status: "failed", launched: true });
    expect(result.message).toContain(`${stream} exceeded 1048576 bytes`);
    expect(statSync(join(root, `generic-cli-${stream}.log`)).size).toBe(1048576);
  });

  it("does not claim success when a repair closes stdin before accepting its prompt", async () => {
    const root = agentFixture("", false);
    writeFileSync(join(root, "prompt.md"), "x".repeat(4 * 1024 * 1024));
    writeFileSync(join(root, "repair.cjs"), "require('node:fs').closeSync(0);setTimeout(()=>{},500);");
    const result = await launch(root, { timeoutMs: 1500 });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("stdin failed");
  });

  it("reports a log persistence failure despite a zero-exit repair", async () => {
    const root = agentFixture("console.log('local repair completed');");
    mkdirSync(join(root, "generic-cli-stdout.log"));
    const result = await launch(root, { timeoutMs: 2000 });
    expect(result).toMatchObject({ status: "failed", launched: true });
    expect(result.message).toContain("Cannot persist stdoutPath");
    expect(result.stdoutPath).toBeUndefined();
    expect(result.stderrPath).toBeDefined();
  });

  it.skipIf(process.platform !== "win32")("stops honestly when the host cannot start its tree-termination helper", async () => {
    const root = agentFixture("fs.writeFileSync('ready','yes');setTimeout(()=>{fs.writeFileSync('expired','yes');},800);");
    const env = { ...process.env };
    const systemRoot = process.env.SystemRoot;
    try {
      // Real failed helper spawn, with the repair itself using the original valid OS environment.
      process.env.SystemRoot = join(root, "unavailable-host-tools");
      const result = await launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: root, promptPath: join(root, "prompt.md"), command: `"${process.execPath}" repair.cjs`, timeoutMs: 200, env });
      expect(result).toMatchObject({ status: "failed", launched: true });
      expect(result.message).toContain("cleanup-unverified");
      expect(result.message).toContain("stop automation");
    } finally {
      if (systemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = systemRoot;
      await wait(1100); // Only this intentionally uncontained finite fixture expires itself.
    }
    expect(existsSync(join(root, "expired"))).toBe(true);
  });

  // The real Windows Node fixture did not retain the pipe after root exit; it cannot certify this case.
  it.skipIf(process.platform === "win32")("fails boundedly when the root exits but a descendant retains the output pipe", async () => {
    const root = agentFixture(`
require('node:child_process').spawn(process.execPath,['descendant.cjs'],{stdio:['ignore','inherit','inherit']});
const poll=setInterval(()=>{if(fs.existsSync('pipe-ready')){clearInterval(poll);process.exit(0);}},10);
setTimeout(()=>{clearInterval(poll);process.exit(8);},2200);
`);
    writeFileSync(join(root, "descendant.cjs"), `
const fs=require('node:fs'),parentPid=process.ppid;
fs.writeFileSync('pipe-ready',JSON.stringify({pid:process.pid,parentPid,expiresAt:Date.now()+6000}));
const beat=setInterval(()=>{
  fs.appendFileSync('pipe-beats','.');
  process.stdout.write('.');
  if(!fs.existsSync('root-exited')){
    try{process.kill(parentPid,0);}catch(error){
      if(error.code!=='ESRCH')throw error;
      fs.writeFileSync('root-exited',JSON.stringify({parentPid,observedAt:Date.now()}));
      console.log('inherited pipe after root exit');
    }
  }
},25);
setTimeout(()=>{clearInterval(beat);fs.writeFileSync('pipe-expired','yes');},6000);
`);
    const start = Date.now();
    let stoppedBeforeExpiry = false;
    try {
      const result = await launch(root, { timeoutMs: 350 });
      const ready = existsSync(join(root, "pipe-ready")) ? JSON.parse(readFileSync(join(root, "pipe-ready"), "utf8")) : null;
      const rootExit = existsSync(join(root, "root-exited")) ? JSON.parse(readFileSync(join(root, "root-exited"), "utf8")) : null;
      const beats = existsSync(join(root, "pipe-beats")) ? readFileSync(join(root, "pipe-beats"), "utf8") : "";
      await wait(300);
      const after = existsSync(join(root, "pipe-beats")) ? readFileSync(join(root, "pipe-beats"), "utf8") : "";
      const expired = existsSync(join(root, "pipe-expired"));
      console.log(JSON.stringify({ scenario: "POSIX inherited pipe", elapsedMs: Date.now() - start, ready, rootExit, heartbeatBefore: beats.length, heartbeatAfter: after.length, expired, result }));
      expect(result.status).toBe("failed");
      expect(result.message).toContain("timed out");
      // Stopped activity is independent evidence; it does not override an unverified group result.
      if (result.message.includes("cleanup-unverified")) expect(result.message).toContain("stop automation");
      expect(ready).not.toBeNull();
      expect(rootExit?.parentPid).toBe(ready.parentPid);
      expect(rootExit.observedAt - start).toBeLessThan(350);
      expect(readFileSync(join(root, "generic-cli-stdout.log"), "utf8")).toContain("inherited pipe after root exit");
      expect(beats.length).toBeGreaterThan(0);
      expect(after).toBe(beats);
      expect(expired).toBe(false);
      expect(Date.now()).toBeLessThan(ready.expiresAt);
      expect(Date.now() - start).toBeLessThan(3000);
      stoppedBeforeExpiry = true;
    } finally {
      // On a failed assertion let this owned finite fixture expire before temp-root teardown.
      if (!stoppedBeforeExpiry) await wait(Math.max(0, 8000 - (Date.now() - start)));
    }
  }, 12000);

  it.skipIf(process.platform === "win32")("escalates a POSIX repair that ignores TERM", async () => {
    const root = agentFixture(`
let termAt;
process.on('SIGTERM',()=>{termAt=Date.now();fs.writeFileSync('term-received',String(termAt));});
fs.writeFileSync('ready',JSON.stringify({pid:process.pid,expiresAt:Date.now()+6000}));
const beat=setInterval(()=>{
  fs.appendFileSync('beats','.');
  if(termAt!==undefined)fs.writeFileSync('active-after-term',String(Date.now()));
},25);
setTimeout(()=>{clearInterval(beat);fs.writeFileSync('expired','yes');},6000);
`);
    const start = Date.now();
    let stoppedBeforeExpiry = false;
    try {
      const result = await launch(root, { timeoutMs: 500 });
      const ready = existsSync(join(root, "ready")) ? JSON.parse(readFileSync(join(root, "ready"), "utf8")) : null;
      const termAt = existsSync(join(root, "term-received")) ? Number(readFileSync(join(root, "term-received"), "utf8")) : null;
      const activeAfterTerm = existsSync(join(root, "active-after-term")) ? Number(readFileSync(join(root, "active-after-term"), "utf8")) : null;
      const beats = existsSync(join(root, "beats")) ? readFileSync(join(root, "beats"), "utf8") : "";
      await wait(300);
      const after = existsSync(join(root, "beats")) ? readFileSync(join(root, "beats"), "utf8") : "";
      const expired = existsSync(join(root, "expired"));
      console.log(JSON.stringify({ scenario: "POSIX ignored TERM", elapsedMs: Date.now() - start, ready, termAt, activeAfterTerm, heartbeatBefore: beats.length, heartbeatAfter: after.length, expired, result }));
      expect(result.status).toBe("failed");
      expect(result.message).toContain("timed out");
      if (result.message.includes("cleanup-unverified")) expect(result.message).toContain("stop automation");
      expect(ready).not.toBeNull();
      expect(termAt).not.toBeNull();
      expect(activeAfterTerm).toBeGreaterThan(termAt!);
      expect(beats.length).toBeGreaterThan(0);
      expect(after).toBe(beats);
      expect(expired).toBe(false);
      expect(Date.now()).toBeLessThan(ready.expiresAt);
      expect(Date.now() - start).toBeLessThan(3000);
      stoppedBeforeExpiry = true;
    } finally {
      if (!stoppedBeforeExpiry) await wait(Math.max(0, 8000 - (Date.now() - start)));
    }
  }, 12000);

  it("removes cancellation listeners after repeated normal completions", async () => {
    const controller = new AbortController();
    for (let i = 0; i < 6; i++) {
      const root = agentFixture("console.log('finished');");
      expect(await launch(root, { timeoutMs: 1000, signal: controller.signal })).toMatchObject({ status: "launched", exitCode: 0 });
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
  });
});

function agentFixture(source: string, readPrompt = true): string {
  const root = tempRoot();
  writeFileSync(join(root, "prompt.md"), "Repair the local checks; do not weaken them.");
  writeFileSync(join(root, "repair.cjs"), `const fs=require('node:fs');${readPrompt ? "if(fs.readFileSync(0,'utf8')!==fs.readFileSync(process.env.PROOFLOOP_REPAIR_PROMPT,'utf8'))throw Error('prompt mismatch');" : ""}\n${source}`);
  return root;
}
function launch(root: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return launchProofloopAgentAdapter({ adapterId: "generic-cli", targetDir: root, promptPath: join(root, "prompt.md"), command: `"${process.execPath}" repair.cjs`, ...options });
}
function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(condition: () => boolean): Promise<void> {
  const end = Date.now() + 2000;
  while (!condition() && Date.now() < end) await wait(20);
  expect(condition()).toBe(true);
}
