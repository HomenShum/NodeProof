import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import { verifyNodekitProofBinding } from "../src/nodekitProof";
import { runProofloopProgram, type ProofloopProgramAuthority, type ProofloopProgramPlan } from "../src/program";
import type { ProofloopRunnerPlan } from "../src/runner";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-nodekit-proof-"));
  tempRoots.push(root);
  return root;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function withReceiptDigest<T extends Record<string, unknown>>(receipt: T): T & { receiptDigest: string } {
  return { ...receipt, receiptDigest: sha256(JSON.stringify(receipt)) };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

type NodekitFixture = {
  candidateCommit: string;
  configHash: string;
};

function writeNodekitFixture(root: string): NodekitFixture {
  const manifest = "apiVersion: nodeagent.dev/v1\nkind: AgentApplication\nmetadata:\n  name: test-agent\n";
  const toolSource = "export const check = () => 'ok';\n";
  mkdirSync(join(root, "agent", "tools"), { recursive: true });
  writeFileSync(join(root, "nodeagent.yaml"), manifest, "utf8");
  writeFileSync(join(root, "agent", "tools", "check.mjs"), toolSource, "utf8");

  git(root, ["init"]);
  git(root, ["config", "user.email", "proofloop@example.test"]);
  git(root, ["config", "user.name", "ProofLoop Test"]);
  git(root, ["add", "nodeagent.yaml", "agent/tools/check.mjs"]);
  git(root, ["commit", "-m", "initial NodeKit candidate"]);
  const candidateCommit = git(root, ["rev-parse", "HEAD"]);

  const configHash = sha256("resolved-test-configuration");
  const discoveredBytes = Buffer.from(toolSource, "utf8");
  writeJson(join(root, ".nodeagent", "resolved-definition.json"), {
    schemaVersion: "nodeagent.resolved/v1",
    configHash,
    fileCount: 1,
    manifestDigest: sha256(manifest),
  });
  mkdirSync(join(root, ".nodeagent"), { recursive: true });
  writeFileSync(join(root, ".nodeagent", "config-hash.txt"), `${configHash}\n`, "utf8");
  writeJson(join(root, ".nodeagent", "discovery.json"), {
    schemaVersion: "nodeagent.discovery/v1",
    files: [{
      path: "agent/tools/check.mjs",
      bytes: discoveredBytes.byteLength,
      digest: sha256(discoveredBytes),
    }],
  });
  writeJson(join(root, "proof", "demo-receipt.json"), withReceiptDigest({
    schemaVersion: "nodekit.smb-lending-receipt/v1",
    configHash,
    applicationHash: configHash,
    candidate: { commit: candidateCommit, dirty: false },
  }));
  writeJson(join(root, "proof", "eval-receipt.json"), withReceiptDigest({
    schemaVersion: "nodekit.smb-lending-eval-receipt/v1",
    passed: true,
    configHash,
    applicationHash: configHash,
    candidate: { commit: candidateCommit, dirty: false },
  }));
  writeJson(join(root, "proof", "release-proof.json"), {
    schemaVersion: "nodekit.proof-receipt/v1",
    configHash,
    applicationHash: configHash,
    generatedAt: "2026-07-20T00:00:00.000Z",
    level: "local-ready",
    passed: true,
    releaseReady: false,
    checks: {
      deterministicDemo: true,
      deterministicEvaluation: true,
      secretFree: true,
      livePi: null,
      browserQa: null,
      deployment: null,
    },
    missingReleaseGates: ["live model", "browser", "deployment"],
    receiptVerification: {
      schemaVersion: "nodekit.local-receipt-verification/v1",
      passed: true,
      applicationHash: configHash,
      candidateCommit,
    },
  });
  return { candidateCommit, configHash };
}

function writeProgramAuthority(root: string): void {
  const authority: ProofloopProgramAuthority = {
    schema: "proofloop-program-authority-v1",
    authorityId: "nodekit-proof-authority",
    allowedArcModes: ["read_only", "proposal_only"],
    allowExternalEgress: false,
    maxBudgetUsd: 1,
    maxAttemptsPerArc: 1,
  };
  writeJson(join(root, "authority.json"), authority);
}

function writeNoopRunnerPlan(root: string): string {
  const plan: ProofloopRunnerPlan = {
    schema: "proofloop-runner-plan-v1",
    tasks: [{
      id: "local-proof",
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.exit(0)")}`,
      estimatedCostUsd: 0,
    }],
  };
  writeJson(join(root, "plans", "noop.json"), plan);
  return "plans/noop.json";
}

describe("NodeKit proof binding", () => {
  it("binds a local-ready NodeKit proof to its compiled identity and current candidate commit", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: fixture.candidateCommit,
    });

    expect(result.ok).toBe(true);
    expect(result.identity?.configHash).toBe(fixture.configHash);
    expect(result.identity?.candidateCommit).toBe(fixture.candidateCommit);
    expect(result.gateReceipts.map((receipt) => [receipt.id, receipt.ok])).toEqual([["demo", true], ["evaluation", true]]);
  });

  it("fails closed when the candidate commit, discovered source bytes, or required gate receipt does not match", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);
    writeFileSync(join(root, "agent", "tools", "check.mjs"), "export const check = () => 'changed';\n", "utf8");
    rmSync(join(root, "proof", "eval-receipt.json"));

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: "0".repeat(40),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`candidate commit mismatch: expected ${"0".repeat(40)}, observed ${fixture.candidateCommit}`);
    expect(result.errors).toContain("NodeKit discovered file agent/tools/check.mjs digest changed");
    expect(result.gateReceipts.find((receipt) => receipt.id === "evaluation")?.ok).toBe(false);
  });

  it("rejects regenerated discovery when its source bytes are not part of the candidate commit", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);
    const regeneratedSource = "export const check = () => 'regenerated-but-uncommitted';\n";
    const regeneratedBytes = Buffer.from(regeneratedSource, "utf8");
    writeFileSync(join(root, "agent", "tools", "check.mjs"), regeneratedSource, "utf8");
    writeJson(join(root, ".nodeagent", "discovery.json"), {
      schemaVersion: "nodeagent.discovery/v1",
      files: [{
        path: "agent/tools/check.mjs",
        bytes: regeneratedBytes.byteLength,
        digest: sha256(regeneratedBytes),
      }],
    });

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: fixture.candidateCommit,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`NodeKit discovered file agent/tools/check.mjs bytes do not match candidate commit ${fixture.candidateCommit}`);
  });

  it("rejects a gate receipt whose configHash belongs to a different compiled application", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);
    const evalPath = join(root, "proof", "eval-receipt.json");
    const evalReceipt = JSON.parse(readFileSync(evalPath, "utf8")) as Record<string, unknown>;
    evalReceipt.configHash = "f".repeat(64);
    writeJson(evalPath, evalReceipt);

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: fixture.candidateCommit,
    });

    expect(result.ok).toBe(false);
    expect(result.gateReceipts.find((receipt) => receipt.id === "evaluation")?.errors).toContain(
      "evaluation gate receipt configHash does not match the compiled NodeKit configHash",
    );
  });

  it("rejects an emitted receiptDigest after any covered receipt content changes", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);
    const demoPath = join(root, "proof", "demo-receipt.json");
    const demoReceipt = JSON.parse(readFileSync(demoPath, "utf8")) as Record<string, unknown>;
    demoReceipt.extraAssertion = "tampered after the digest was emitted";
    writeJson(demoPath, demoReceipt);

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: fixture.candidateCommit,
    });

    expect(result.ok).toBe(false);
    expect(result.gateReceipts.find((receipt) => receipt.id === "demo")?.errors).toContain(
      "demo gate receipt receiptDigest does not match content",
    );
  });

  it("requires the three release-only receipts when release-ready proof is requested", () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);

    const result = verifyNodekitProofBinding({
      root,
      releaseProofPath: "proof/release-proof.json",
      candidateCommit: fixture.candidateCommit,
      minimumLevel: "release-ready",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("NodeKit release proof does not meet required release-ready level");
    expect(result.gateReceipts.map((receipt) => [receipt.id, receipt.ok])).toEqual([
      ["demo", true],
      ["evaluation", true],
      ["live", false],
      ["browser", false],
      ["deployment", false],
    ]);
  });

  it("is available through both the CLI and a local-only P0 program receipt hook", async () => {
    const root = tempRoot();
    const fixture = writeNodekitFixture(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runCli([
        "--dir", root,
        "program", "verify-nodekit",
        "--file", "proof/release-proof.json",
        "--candidate-commit", fixture.candidateCommit,
        "--json",
      ])).toBe(0);

      writeProgramAuthority(root);
      const runnerPlan = writeNoopRunnerPlan(root);
      const program: ProofloopProgramPlan = {
        schema: "proofloop-program-plan-v1",
        programId: "nodekit-binding-program",
        authorityPath: "authority.json",
        arcs: [{
          id: "verify-nodekit",
          mode: "read_only",
          runnerPlan,
          receipt: {
            kind: "nodekit-proof",
            file: "proof/release-proof.json",
            candidateCommit: fixture.candidateCommit,
          },
        }],
      };
      writeJson(join(root, "program.json"), program);
      const run = await runProofloopProgram({
        root,
        subcommand: "run",
        planPath: "program.json",
        runId: "nodekit-binding",
        log: () => undefined,
        logError: () => undefined,
      });
      expect(run.exitCode).toBe(0);
      expect(run.state.status).toBe("certified");
      expect(run.state.arcStates[0]?.receipt).toMatchObject({ kind: "nodekit-proof", ok: true });
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
