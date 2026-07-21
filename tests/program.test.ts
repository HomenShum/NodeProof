import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import {
  programLedgerPath,
  programRunDir,
  programStatePath,
  runProofloopProgram,
  type ProofloopProgramAuthority,
  type ProofloopProgramPlan,
  type ProofloopProgramState,
} from "../src/program";
import {
  PROOFLOOP_RECEIPT_SCHEMA,
  createInlineProofReceiptPayload,
  createInlineProofReceiptResource,
  type ProofReceiptEnvelope,
} from "../src/proofReceipt";
import type { ProofloopRunnerPlan } from "../src/runner";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-program-"));
  tempRoots.push(root);
  return root;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

function appendMarkerCommand(value: string, exitCode = 0): string {
  return nodeCommand([
    "const fs=require('node:fs');",
    "fs.appendFileSync(process.env.MARKER,process.env.VALUE+String.fromCharCode(10));",
    `process.exit(${exitCode});`,
  ].join(""));
}

function writeRunnerPlan(root: string, id: string, marker: string, value: string, estimatedCostUsd: number, exitCode = 0): string {
  const relativePath = join("plans", `${id}.runner.json`);
  const absolutePath = join(root, relativePath);
  mkdirSync(join(root, "plans"), { recursive: true });
  const plan: ProofloopRunnerPlan = {
    schema: "proofloop-runner-plan-v1",
    tasks: [{
      id: `${id}.task`,
      command: appendMarkerCommand(value, exitCode),
      env: { MARKER: marker, VALUE: value },
      estimatedCostUsd,
    }],
  };
  writeFileSync(absolutePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return relativePath.replace(/\\/g, "/");
}

function writeAuthority(root: string, overrides: Partial<ProofloopProgramAuthority> = {}): void {
  const authority: ProofloopProgramAuthority = {
    schema: "proofloop-program-authority-v1",
    authorityId: "overnight-authority",
    allowedArcModes: ["read_only", "proposal_only"],
    allowExternalEgress: false,
    maxBudgetUsd: 10,
    maxAttemptsPerArc: 1,
    ...overrides,
  };
  writeFileSync(join(root, "authority.json"), `${JSON.stringify(authority, null, 2)}\n`, "utf8");
}

function writeProgram(root: string, arcs: ProofloopProgramPlan["arcs"]): string {
  const plan: ProofloopProgramPlan = {
    schema: "proofloop-program-plan-v1",
    programId: "overnight-program",
    authorityPath: "authority.json",
    arcs,
  };
  const path = join(root, "program.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return "program.json";
}

function readState(root: string, runId: string): ProofloopProgramState {
  return JSON.parse(readFileSync(programStatePath(programRunDir(root, runId)), "utf8")) as ProofloopProgramState;
}

function writePassingEnvelope(root: string, relativePath = "receipt.json"): string {
  const evidence = createInlineProofReceiptResource({ id: "gate-evidence", kind: "test-evidence", inline: { gate: "passed" } });
  const envelope: ProofReceiptEnvelope = {
    schema: PROOFLOOP_RECEIPT_SCHEMA,
    schemaVersion: 1,
    receiptId: "program-gate-receipt",
    kind: "program-gate",
    createdAt: "2026-07-20T00:00:00.000Z",
    producer: { id: "proofloop", version: "0.3.0" },
    subject: { type: "workflow", id: "program-test" },
    verdict: {
      status: "passed",
      authority: "authoritative",
      decisionMethod: "deterministic_gate",
      decisiveCheckIds: ["gate"],
      summary: "The deterministic program gate passed.",
    },
    checks: [{
      id: "gate",
      status: "passed",
      role: "decisive",
      method: "deterministic",
      summary: "The test command exited zero.",
      evidenceRefs: [evidence.id],
      exitCode: 0,
    }],
    evidence: [evidence],
    payload: createInlineProofReceiptPayload("program-test-payload/v1", { status: "passed" }, 1),
  };
  writeFileSync(join(root, relativePath), `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return relativePath;
}

describe("proofloop program", () => {
  it("runs arcs in stable dependency order, verifies a receipt, and resumes only queued work", async () => {
    const root = tempRoot();
    const marker = join(root, "order.txt");
    writeAuthority(root);
    const firstPlan = writeRunnerPlan(root, "first", marker, "first", 0.1);
    const secondPlan = writeRunnerPlan(root, "second", marker, "second", 0.1);
    const receipt = writePassingEnvelope(root);
    const programPath = writeProgram(root, [
      { id: "second", mode: "proposal_only", runnerPlan: secondPlan, dependsOn: ["first"], receipt: { kind: "proofloop-envelope", file: receipt } },
      { id: "first", mode: "read_only", runnerPlan: firstPlan },
    ]);

    const paused = await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "ordered", maxArcs: 1, log: () => {}, logError: () => {} });
    expect(paused.exitCode).toBe(4);
    expect(paused.state.status).toBe("paused");
    expect(readFileSync(marker, "utf8")).toBe("first\n");
    expect(paused.state.arcStates.map((arc) => [arc.id, arc.status])).toEqual([["first", "passed"], ["second", "queued"]]);

    const resumed = await runProofloopProgram({ root, subcommand: "resume", runId: "ordered", log: () => {}, logError: () => {} });
    expect(resumed.exitCode).toBe(0);
    expect(resumed.state.status).toBe("certified");
    expect(readFileSync(marker, "utf8")).toBe("first\nsecond\n");
    expect(resumed.state.arcStates.find((arc) => arc.id === "second")?.receipt?.ok).toBe(true);
    expect(readFileSync(programLedgerPath(programRunDir(root, "ordered")), "utf8")).toContain("receipt_verified");
  });

  it("binds the authority digest and blocks a changed authority before executing queued arcs", async () => {
    const root = tempRoot();
    const marker = join(root, "authority.txt");
    writeAuthority(root);
    const firstPlan = writeRunnerPlan(root, "first", marker, "first", 0.1);
    const secondPlan = writeRunnerPlan(root, "second", marker, "second", 0.1);
    const programPath = writeProgram(root, [
      { id: "first", mode: "read_only", runnerPlan: firstPlan },
      { id: "second", mode: "proposal_only", runnerPlan: secondPlan, dependsOn: ["first"] },
    ]);

    await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "authority", maxArcs: 1, log: () => {}, logError: () => {} });
    writeAuthority(root, { maxBudgetUsd: 9 });
    const blocked = await runProofloopProgram({ root, subcommand: "resume", runId: "authority", log: () => {}, logError: () => {} });

    expect(blocked.exitCode).toBe(4);
    expect(blocked.state.status).toBe("blocked_authority");
    expect(readFileSync(marker, "utf8")).toBe("first\n");
    expect(readFileSync(programLedgerPath(programRunDir(root, "authority")), "utf8")).toContain("authority_digest_changed");
  });

  it("blocks declared external egress before the runner can execute", async () => {
    const root = tempRoot();
    const marker = join(root, "egress.txt");
    writeAuthority(root);
    const runnerPlan = writeRunnerPlan(root, "external", marker, "should-not-run", 0);
    const programPath = writeProgram(root, [{
      id: "external",
      mode: "read_only",
      runnerPlan,
      externalEgress: true,
    }]);

    const blocked = await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "egress", log: () => {}, logError: () => {} });

    expect(blocked.exitCode).toBe(4);
    expect(blocked.state.status).toBe("blocked_authority");
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects non-portable durable identifiers before dispatch", async () => {
    const root = tempRoot();
    const marker = join(root, "portable-id.txt");
    writeAuthority(root);
    const runnerPlan = writeRunnerPlan(root, "portable", marker, "should-not-run", 0);
    const programPath = writeProgram(root, [{ id: "bad:arc", mode: "read_only", runnerPlan }]);

    const rejected = await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "portable", log: () => {}, logError: () => {} });

    expect(rejected.exitCode).toBe(2);
    expect(rejected.state.status).toBe("failed_integrity");
    expect(existsSync(marker)).toBe(false);
  });

  it("enforces the program budget across sequential arcs", async () => {
    const root = tempRoot();
    const marker = join(root, "budget.txt");
    writeAuthority(root, { maxBudgetUsd: 0.4 });
    const firstPlan = writeRunnerPlan(root, "first", marker, "first", 0.3);
    const secondPlan = writeRunnerPlan(root, "second", marker, "second", 0.3);
    const programPath = writeProgram(root, [
      { id: "first", mode: "read_only", runnerPlan: firstPlan },
      { id: "second", mode: "proposal_only", runnerPlan: secondPlan, dependsOn: ["first"] },
    ]);

    const result = await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "budget", log: () => {}, logError: () => {} });

    expect(result.exitCode).toBe(3);
    expect(result.state.status).toBe("blocked_budget");
    expect(readFileSync(marker, "utf8")).toBe("first\n");
    expect(result.state.arcStates.map((arc) => [arc.id, arc.status])).toEqual([["first", "passed"], ["second", "blocked_budget"]]);
  });

  it("does not automatically requeue a failed arc on resume", async () => {
    const root = tempRoot();
    const marker = join(root, "failed.txt");
    writeAuthority(root);
    const runnerPlan = writeRunnerPlan(root, "failing", marker, "attempt", 0, 1);
    const programPath = writeProgram(root, [{ id: "failing", mode: "read_only", runnerPlan }]);

    const failed = await runProofloopProgram({ root, subcommand: "run", planPath: programPath, runId: "failed", log: () => {}, logError: () => {} });
    expect(failed.exitCode).toBe(1);
    expect(failed.state.status).toBe("failed");
    expect(readState(root, "failed").arcStates[0]?.attempts).toBe(1);

    const resumed = await runProofloopProgram({ root, subcommand: "resume", runId: "failed", log: () => {}, logError: () => {} });
    expect(resumed.exitCode).toBe(1);
    expect(readState(root, "failed").arcStates[0]?.attempts).toBe(1);
    expect(readFileSync(marker, "utf8")).toBe("attempt\n");
  });

  it("exposes the program supervisor through the public CLI", async () => {
    const root = tempRoot();
    const marker = join(root, "cli.txt");
    writeAuthority(root);
    const runnerPlan = writeRunnerPlan(root, "cli", marker, "cli", 0);
    const programPath = writeProgram(root, [{ id: "cli", mode: "read_only", runnerPlan }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const code = await runCli(["--dir", root, "program", "run", "--plan", programPath, "--run-id", "cli"]);
      expect(code).toBe(0);
      expect(readFileSync(marker, "utf8")).toBe("cli\n");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
