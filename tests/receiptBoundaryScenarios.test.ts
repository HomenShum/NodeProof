/**
 * A developer delegates local proof arcs, inspects receipts, and decides whether
 * dependent work may proceed. The same desired assertions run against the
 * original feature and the corrected current-main port. Fixtures are supplied
 * evidence, not live NodeKit/browser/provider certification.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { verifyEaseProof } from "../src/easeProof";
import { verifyNodekitProofBinding } from "../src/nodekitProof";
import { programRunDir, programStatePath, runProofloopProgram, type ProofloopProgramAuthority, type ProofloopProgramPlan, type ProofloopProgramState } from "../src/program";
import { PROOFLOOP_RECEIPT_SCHEMA, createInlineProofReceiptPayload, createInlineProofReceiptResource, verifyProofReceiptEnvelopeFile, type ProofReceiptEnvelope } from "../src/proofReceipt";
import type { ProofloopRunnerPlan } from "../src/runner";

const REPO_ROOT = join(__dirname, "..");
const CLI = join(REPO_ROOT, "dist", "cli.js");
const MAX_BYTES = 10 * 1024 * 1024;
const tempRoots: string[] = [];
const activeChildren = new Map<ReturnType<typeof spawn>, Promise<void>>();
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const writeJson = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
const withReceiptDigest = <T extends Record<string, unknown>>(receipt: T): T & { receiptDigest: string } => ({ ...receipt, receiptDigest: sha256(JSON.stringify(receipt)) });
function tempRoot(): string { const root = mkdtempSync(join(tmpdir(), "proofloop-boundary-")); tempRoots.push(root); return root; }
function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
afterEach(async () => {
  const owned = [...activeChildren];
  for (const [child] of owned) child.kill();
  if (owned.length) await Promise.race([
    Promise.all(owned.map(([, closed]) => closed)),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("owned CLI cleanup exceeded 5s")), 5_000); timer.unref(); }),
  ]);
  expect(activeChildren.size).toBe(0);
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function cli(args: string[], root: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "SystemRoot", "COMSPEC", "HOME", "USERPROFILE", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(process.execPath, [CLI, ...args, "--dir", root], { cwd: REPO_ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", fault: Error | undefined;
    let close!: () => void;
    activeChildren.set(child, new Promise<void>((done) => { close = done; }));
    const deadline = setTimeout(() => { fault = new Error("owned receipt CLI exceeded 10s"); child.kill(); }, 10_000);
    for (const [stream, kind] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) stream.on("data", (chunk: Buffer) => {
      if (kind === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 256 * 1024) { fault = new Error("owned receipt CLI output exceeds 256KiB"); child.kill(); }
    });
    child.on("error", (error) => { fault = error; });
    child.on("close", (status) => { clearTimeout(deadline); activeChildren.delete(child); close(); if (fault) reject(fault); else resolve({ status: status ?? -1, stdout, stderr }); });
  });
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
      timeoutMs: 5_000,
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


function writeEaseFixture() {
  const root = mkdtempSync(join(tmpdir(), "proofloop-ease-"));
  tempRoots.push(root);
  const evidence = join(root, "proof", "ease", "latest");
  const png = Buffer.from("png-evidence");
  const candidate = Buffer.from("candidate-archive");
  const trace = Buffer.from("playwright-trace");
  const video = Buffer.from("browser-video");
  const commit = "a".repeat(40);
  const hash = "b".repeat(64);
  const screenshotPath = join(evidence, "browser", "screenshots", "arrival.png");
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  writeFileSync(join(evidence, "candidate.tar.gz"), candidate);
  writeFileSync(join(evidence, "browser", "playwright-trace.zip"), trace);
  writeFileSync(join(evidence, "browser", "journey.webm"), video);
  const browser: Record<string, unknown> = {
    schemaVersion: "nodekit.browser-certification/v1",
    certified: false,
    missingStates: ["fresh_human"],
    serverProcess: { command: "node apps/web/server.mjs", pid: 1234 },
    journeyAssertions: { proposalVisible: true, approvalApplied: true, receiptVisible: true, receiptSurvivedReload: true },
    evidenceArtifacts: [
      { id: "playwright-trace", path: "browser/playwright-trace.zip", sha256: sha256(trace), byteSize: trace.byteLength },
      { id: "browser-video", path: "browser/journey.webm", sha256: sha256(video), byteSize: video.byteLength },
    ],
    screenshots: [{
      path: "browser/screenshots/arrival.png",
      pngSha256: sha256(png),
      generatedCandidateCommit: commit,
      applicationHash: hash,
      configHash: hash,
      nodekitSourceHash: hash,
      consoleErrors: 0,
      failedRequests: 0,
      horizontalOverflowPx: 0,
      mojibakeDetected: false,
    }],
  };
  browser.manifestSha256 = sha256(JSON.stringify(browser));
  writeJson(join(evidence, "browser", "screenshot-manifest.json"), browser);
  const manifest: Record<string, unknown> = {
    schemaVersion: "nodekit.ease-proof-run/v1",
    runId: "ease_test",
    startedAt: "2026-07-21T00:00:00.000Z",
    generatedAt: "2026-07-21T00:00:01.000Z",
    durationMs: 1000,
    nodekitSourceHash: hash,
    base: { applicationHash: hash, configHash: hash, candidateCommit: commit, browserManifestDigest: browser.manifestSha256, phases: [{ name: "scaffold", durationMs: 10, exitCode: 0 }] },
    submissionReady: false,
    submissionBlockers: ["freshHumanUsability"],
  };
  manifest.receiptDigest = sha256(JSON.stringify(manifest));
  writeJson(join(evidence, "manifest.json"), manifest);
  return { evidence, root, screenshotPath };
}


function changeJson(path: string, change: (value: Record<string, unknown>) => void, digestKey?: string): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (digestKey) delete value[digestKey];
  change(value);
  if (digestKey) value[digestKey] = sha256(JSON.stringify(value));
  writeJson(path, value);
}
function suppliedEnvelope(root: string, variant: string): string {
  const fixture = variant === "advisory" ? "valid-solo-advisory.json" : variant === "informational" ? "valid-hosted-informational.json" : "valid-gate.json";
  const envelope = JSON.parse(readFileSync(join(__dirname, "fixtures", "receipts", "proofloop-receipt-v1", fixture), "utf8")) as ProofReceiptEnvelope;
  if (["failed", "blocked", "error"].includes(variant)) {
    const status = variant as "failed" | "blocked" | "error";
    envelope.verdict.status = status;
    envelope.checks[0].status = status;
    delete envelope.checks[0].exitCode;
  }
  if (variant === "malformed") envelope.schemaVersion = 2 as 1;
  writeJson(join(root, "receipt.json"), envelope);
  return "receipt.json";
}
function referenceEnvelope(root: string, bytes: Buffer, relativePath = "evidence.bin"): string {
  const envelope = JSON.parse(readFileSync(join(__dirname, "fixtures", "receipts", "proofloop-receipt-v1", "valid-gate.json"), "utf8")) as ProofReceiptEnvelope;
  envelope.payload = { schema: "owned-evidence/v1", mode: "reference", ref: relativePath, sha256: sha256(bytes), hashMethod: "raw-bytes-sha256" };
  writeJson(join(root, "receipt.json"), envelope);
  return "receipt.json";
}
function certifySuppliedEase(evidence: string): void {
  changeJson(join(evidence, "browser", "screenshot-manifest.json"), (value) => { value.certified = true; }, "manifestSha256");
  const browser = JSON.parse(readFileSync(join(evidence, "browser", "screenshot-manifest.json"), "utf8")) as { manifestSha256: string };
  changeJson(join(evidence, "manifest.json"), (value) => {
    value.submissionReady = true; value.submissionBlockers = [];
    (value.base as Record<string, unknown>).browserManifestDigest = browser.manifestSha256;
  }, "receiptDigest");
}

describe("a developer cannot unlock work using the wrong receipt verdict", () => {
  for (const variant of ["passed", "failed", "blocked", "error", "advisory", "informational", "malformed"]) {
    it(`inspects ${variant} evidence separately from program eligibility`, async () => {
      const root = tempRoot();
      const file = suppliedEnvelope(root, variant);
      const inspection = verifyProofReceiptEnvelopeFile({ root, filePath: file });
      expect(inspection.ok).toBe(variant !== "malformed");
      writeAuthority(root);
      const marker = join(root, "dependent.txt");
      const first = writeRunnerPlan(root, "inspect", marker, "inspect", 0);
      const next = writeRunnerPlan(root, "dependent", marker, "dependent", 0);
      const plan = writeProgram(root, [
        { id: "inspect", mode: "read_only", runnerPlan: first, receipt: { kind: "proofloop-envelope", file } },
        { id: "dependent", mode: "proposal_only", runnerPlan: next, dependsOn: ["inspect"] },
      ]);
      const result = await runProofloopProgram({ root, subcommand: "run", planPath: plan, runId: "receipt-policy", log: () => {}, logError: () => {} });
      expect(result.state.status).toBe(variant === "passed" ? "certified" : "failed");
      expect(result.exitCode).toBe(variant === "passed" ? 0 : 1);
      expect(readFileSync(marker, "utf8")).toBe(variant === "passed" ? "inspect\ndependent\n" : "inspect\n");
    }, 20_000);
  }
});

describe("a release engineer uses only actual required NodeKit gate verdicts", () => {
  for (const verdict of ["missing", "false", "true"]) {
    it(`handles an evaluation verdict that is ${verdict} while retaining the Demo exemption`, () => {
      const root = tempRoot(), fixture = writeNodekitFixture(root);
      changeJson(join(root, "proof", "eval-receipt.json"), (value) => { if (verdict === "missing") delete value.passed; else value.passed = verdict === "true"; }, "receiptDigest");
      const result = verifyNodekitProofBinding({ root, releaseProofPath: "proof/release-proof.json", candidateCommit: fixture.candidateCommit });
      expect(result.gateReceipts.find((gate) => gate.id === "demo")?.ok).toBe(true);
      expect(result.gateReceipts.find((gate) => gate.id === "evaluation")?.ok).toBe(verdict === "true");
      expect(result.ok).toBe(verdict === "true");
    });
  }
  it("retains an explicitly configured passing live status alias", () => {
    const root = tempRoot(), fixture = writeNodekitFixture(root);
    changeJson(join(root, "proof", "release-proof.json"), (value) => { (value.checks as Record<string, unknown>).livePi = true; });
    writeJson(join(root, "proof", "pi-live-receipt.json"), withReceiptDigest({ schemaVersion: "nodekit.pi-live-receipt/v1", status: "pass", configHash: fixture.configHash, candidate: { commit: fixture.candidateCommit, dirty: false } }));
    const result = verifyNodekitProofBinding({ root, releaseProofPath: "proof/release-proof.json", candidateCommit: fixture.candidateCommit });
    expect(result.ok).toBe(true);
    expect(result.gateReceipts.find((gate) => gate.id === "live")?.ok).toBe(true);
  });
  for (const gate of [
    { id: "live", check: "livePi", filename: "pi-live-receipt.json", schemaVersion: "nodekit.pi-live-receipt/v1" },
    { id: "deployment", check: "deployment", filename: "deployment-receipt.json", schemaVersion: "nodekit.deployment-receipt/v1" },
  ]) {
    it("rejects " + gate.id + " passed=false even when status=pass", () => {
      const root = tempRoot(), fixture = writeNodekitFixture(root);
      changeJson(join(root, "proof", "release-proof.json"), (value) => { (value.checks as Record<string, unknown>)[gate.check] = true; });
      writeJson(join(root, "proof", gate.filename), withReceiptDigest({ schemaVersion: gate.schemaVersion, passed: false, status: "pass", configHash: fixture.configHash, candidate: { commit: fixture.candidateCommit, dirty: false } }));
      const result = verifyNodekitProofBinding({ root, releaseProofPath: "proof/release-proof.json", candidateCommit: fixture.candidateCommit });
      const receipt = result.gateReceipts.find((entry) => entry.id === gate.id);
      expect(receipt).toBeDefined();
      expect(receipt?.errors.filter((error) => !error.startsWith(gate.id + " gate receipt must have passed=true"))).toEqual([]);
      expect(receipt?.ok).toBe(false);
      expect(result.ok).toBe(false);
    });
  }
  it("labels current canonical NodeKit output unsupported rather than weakening identity", () => {
    const root = tempRoot(), fixture = writeNodekitFixture(root);
    changeJson(join(root, "proof", "release-proof.json"), (value) => {
      value.level = "browser-certified";
      value.checks = { deterministicDemo: true, deterministicEvaluation: true, secretFree: true, browserContractPassed: true, browserJourneyPassed: true, browserCertified: true, productionReadinessSatisfied: false };
    });
    const result = verifyNodekitProofBinding({ root, releaseProofPath: "proof/release-proof.json", candidateCommit: fixture.candidateCommit });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith("NOT_SUPPORTED:"))).toBe(true);
  });
});

describe("an evidence reviewer cannot certify tampered Ease artifacts", () => {
  it("retains a valid supplied noncertified integrity result", () => {
    const { root } = writeEaseFixture();
    const result = verifyEaseProof({ root, manifestPath: "proof/ease/latest/manifest.json" });
    expect(result.ok).toBe(true); expect(result.easeCertified).toBe(false);
  });
  it("retains a valid supplied certified result without claiming independent live observation", () => {
    const { root, evidence } = writeEaseFixture(); certifySuppliedEase(evidence);
    const result = verifyEaseProof({ root, manifestPath: "proof/ease/latest/manifest.json" });
    expect(result.errors).toEqual([]); expect(result.ok).toBe(true); expect(result.easeCertified).toBe(true);
  });
  for (const artifact of ["screenshot", "replay", "identity"]) {
    it(`clears certification after ${artifact} evidence fails`, () => {
      const { root, evidence, screenshotPath } = writeEaseFixture(); certifySuppliedEase(evidence);
      if (artifact === "screenshot") writeFileSync(screenshotPath, "tampered");
      if (artifact === "replay") writeFileSync(join(evidence, "browser", "journey.webm"), "tampered");
      if (artifact === "identity") changeJson(join(evidence, "manifest.json"), (value) => { (value.base as Record<string, unknown>).candidateCommit = "c".repeat(40); }, "receiptDigest");
      const result = verifyEaseProof({ root, manifestPath: "proof/ease/latest/manifest.json" });
      expect(result.ok).toBe(false); expect(result.errors.length).toBeGreaterThan(0); expect(result.easeCertified).toBe(false);
      expect(result.envelope?.extensions?.easeCertified ?? false).toBe(false);
    });
  }
  it("does not emit an invalid envelope or mutate its hashed payload after final validation", () => {
    const { root, evidence } = writeEaseFixture(); certifySuppliedEase(evidence);
    changeJson(join(evidence, "manifest.json"), (value) => { value.runId = "invalid id?!"; }, "receiptDigest");
    const output = join(evidence, "output.json");
    const result = verifyEaseProof({ root, manifestPath: "proof/ease/latest/manifest.json", outputPath: output });
    expect(result.ok).toBe(false); expect(result.easeCertified).toBe(false); expect(result.envelope).toBeUndefined(); expect(existsSync(output)).toBe(false);
  });
});

describe("a local evidence reviewer gets bounded regular files and valid recovery", () => {
  for (const bytes of [MAX_BYTES, MAX_BYTES + 1]) {
    it(`admits a ${bytes}-byte input only within the declared limit`, () => {
      const root = tempRoot(), value = Buffer.alloc(bytes, 7);
      writeFileSync(join(root, "evidence.bin"), value);
      const file = referenceEnvelope(root, value);
      const result = verifyProofReceiptEnvelopeFile({ root, filePath: file });
      expect(result.ok).toBe(bytes <= MAX_BYTES);
      writeFileSync(join(root, "evidence.bin"), "valid-recovery");
      referenceEnvelope(root, Buffer.from("valid-recovery"));
      expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(true);
    });
  }
  it("rejects a supplied receipt itself larger than 10MiB then accepts a valid receipt", () => {
    const root = tempRoot(), file = suppliedEnvelope(root, "passed");
    const raw = readFileSync(join(root, file), "utf8");
    writeFileSync(join(root, file), raw + " ".repeat(MAX_BYTES));
    expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(false);
    suppliedEnvelope(root, "passed"); expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(true);
  });
  it("rejects a directory used as evidence and recovers after a regular-file replacement", () => {
    const root = tempRoot(); mkdirSync(join(root, "evidence.bin"));
    const file = referenceEnvelope(root, Buffer.from("directory"));
    expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(false);
    rmSync(join(root, "evidence.bin"), { recursive: true }); writeFileSync(join(root, "evidence.bin"), "recovered"); referenceEnvelope(root, Buffer.from("recovered"));
    expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(true);
  });
  it("rejects an owned directory junction/symlink even when its bytes match", () => {
    const root = tempRoot(), outside = tempRoot(); writeFileSync(join(outside, "evidence.bin"), "outside");
    symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const file = referenceEnvelope(root, Buffer.from("outside"), "linked/evidence.bin");
    const result = verifyProofReceiptEnvelopeFile({ root, filePath: file });
    expect(result.ok).toBe(false); expect(result.errors.some((error) => /symbolic link|junction|escapes/.test(error.message))).toBe(true);
  });
  it("rejects a lexically escaping reference even when the hash matches", () => {
    const root = tempRoot(), outside = tempRoot(); const bytes = Buffer.from("outside"); writeFileSync(join(outside, "evidence.bin"), bytes);
    const file = referenceEnvelope(root, bytes, "../outside/evidence.bin");
    expect(verifyProofReceiptEnvelopeFile({ root, filePath: file }).ok).toBe(false);
  });
  it("returns an honest Ease failure for an oversized replay instead of throwing or certifying", () => {
    const { root, evidence } = writeEaseFixture(); certifySuppliedEase(evidence);
    writeFileSync(join(evidence, "browser", "journey.webm"), Buffer.alloc(MAX_BYTES + 1, 7));
    const result = verifyEaseProof({ root, manifestPath: "proof/ease/latest/manifest.json" });
    expect(result.ok).toBe(false); expect(result.easeCertified).toBe(false); expect(result.errors.some((error) => error.includes("-byte limit"))).toBe(true);
  });
});

describe("an agent burst and one paced observation preserve honest local verdicts", () => {
  it("drains a 12-child receipt inspection burst with exact exit/output verdicts", async () => {
    const root = tempRoot(), valid = suppliedEnvelope(root, "failed");
    writeFileSync(join(root, "bad.json"), "not-json");
    const jobs = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => cli(["receipt", "envelope", "verify", "--file", index % 2 === 0 ? valid : "bad.json", "--json"], root)));
    expect(activeChildren.size).toBe(0);
    for (const [index, job] of jobs.entries()) {
      expect(job.status).toBe("fulfilled"); if (job.status !== "fulfilled") continue;
      expect(job.value.status).toBe(index % 2 === 0 ? 0 : 1);
      const parsed = JSON.parse(index % 2 === 0 ? job.value.stdout : job.value.stderr) as { ok: boolean; envelope?: ProofReceiptEnvelope };
      expect(parsed.ok).toBe(index % 2 === 0);
      if (index % 2 === 0) expect(parsed.envelope?.verdict.status).toBe("failed");
    }
    console.log(JSON.stringify({ observation: "owned-receipt-cli-burst", jobs: jobs.length, activeChildren: activeChildren.size }));
  }, 20_000);
  it("observes 60 seconds of invalid-evidence rejection and valid recovery without a lifetime memory claim", async () => {
    const root = tempRoot(), start = performance.now(), memoryStart = process.memoryUsage();
    const points: Array<{ elapsedMs: number; invalidOk: boolean; validOk: boolean; rss: number }> = [];
    do {
      const file = suppliedEnvelope(root, "passed");
      writeFileSync(join(root, file), "not-json");
      const invalid = verifyProofReceiptEnvelopeFile({ root, filePath: file });
      suppliedEnvelope(root, "passed"); const valid = verifyProofReceiptEnvelopeFile({ root, filePath: file });
      points.push({ elapsedMs: performance.now() - start, invalidOk: invalid.ok, validOk: valid.ok, rss: process.memoryUsage().rss });
      const remaining = 60_000 - (performance.now() - start);
      if (remaining > 0) await new Promise((done) => setTimeout(done, Math.min(2_000, remaining)));
    } while (performance.now() - start < 60_000 && points.length < 32);
    const elapsedMs = performance.now() - start;
    console.log(JSON.stringify({ observation: "60-second-paced-local-receipt-recovery", elapsedMs, memoryStart, memoryEnd: process.memoryUsage(), points, activeChildren: activeChildren.size }));
    expect(elapsedMs).toBeGreaterThanOrEqual(60_000); expect(elapsedMs).toBeLessThan(65_000);
    expect(points.length).toBeGreaterThanOrEqual(2); expect(points.length).toBeLessThanOrEqual(32);
    expect(points.every((point) => !point.invalidOk && point.validOk)).toBe(true); expect(activeChildren.size).toBe(0);
  }, 70_000);
});
