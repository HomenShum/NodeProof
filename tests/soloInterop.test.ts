import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import { readRunnerPlan, type ProofloopRunnerPlan } from "../src/runner";
import { createSoloTrustReceipt, type SoloTrustIssuerKind } from "../src/soloTrust";
import {
  SOLO_INTEROP_SCHEMA_DIGEST,
  SOLO_INTEROP_SCHEMA_FILE_SHA256,
  compileSoloHandoffRunnerPlan,
  ingestSoloInterop,
  runSoloInteropCli,
  soloInteropEnvelopePath,
  soloInteropReceiptPath,
  validateSoloInteropEnvelope,
  type SoloInteropEnvelope,
  type SoloInteropReceiptReference,
} from "../src/soloInterop";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-solo-"));
  roots.push(root);
  writeFileSync(join(root, ".gitignore"), ".proofloop/\n.solo/\n", "utf8");
  writeFileSync(join(root, "app.txt"), "candidate v1\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "proofloop@example.test"]);
  git(root, ["config", "user.name", "ProofLoop Test"]);
  git(root, ["add", ".gitignore", "app.txt"]);
  git(root, ["commit", "-qm", "candidate"]);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeReceipt(root: string, id = "local-proof", kind = "product-proof", required = true): SoloInteropReceiptReference {
  const path = `.solo/${id}.json`;
  const body = `${JSON.stringify({ id, ok: true, generatedAt: "2026-07-10T10:00:00Z" }, null, 2)}\n`;
  mkdirSync(join(root, ".solo"), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
  return {
    id,
    kind,
    path,
    sha256: digest(body),
    producer: kind,
    createdAt: "2026-07-10T10:00:00Z",
    visibility: "private",
    required,
    verifier: "independent-verifier",
  };
}

function trustKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function writeSignedPromotionReceipt(
  root: string,
  current: SoloInteropEnvelope,
  keys: { privateKeyPem: string },
  options: {
    id: string;
    kind: "nodeproof-ci" | "hosted-trust-root";
    issuerKind: SoloTrustIssuerKind;
    priorTier: "local_ready" | "team_ready";
  },
): SoloInteropReceiptReference {
  const envelopePath = join(root, ".solo", `${options.id}-source-envelope.json`);
  const gatePath = join(root, ".solo", `${options.id}-source-gate.json`);
  const receiptPath = join(root, ".solo", `${options.id}.json`);
  mkdirSync(join(root, ".solo"), { recursive: true });
  writeFileSync(envelopePath, JSON.stringify({
    schema: "proofloop-solo-interop-v1",
    programId: current.programId,
    goal: { goalId: current.goal.goalId },
    repository: { candidateCommit: current.repository.candidateCommit },
    claim: { tier: options.priorTier, boundary: current.claim.boundary },
  }), "utf8");
  writeFileSync(gatePath, JSON.stringify({ status: "passed", candidateCommit: current.repository.candidateCommit }), "utf8");
  createSoloTrustReceipt({
    envelopePath,
    gateReceiptPath: gatePath,
    privateKeyPem: keys.privateKeyPem,
    keyId: "test-trust-key",
    outPath: receiptPath,
    issuerKind: options.issuerKind,
    allowLocalTest: true,
    environment: {
      PROOFLOOP_TRUST_REPOSITORY: "acme/product",
      PROOFLOOP_TRUST_WORKFLOW: "proofloop-promotion",
      PROOFLOOP_TRUST_RUN_ID: "123",
      PROOFLOOP_TRUST_ACTOR: "independent-verifier",
    },
  });
  const body = readFileSync(receiptPath);
  return {
    id: options.id,
    kind: options.kind,
    path: `.solo/${options.id}.json`,
    sha256: digest(body),
    producer: options.issuerKind,
    createdAt: "2026-07-10T10:00:00Z",
    visibility: "team",
    required: true,
    verifier: "NodeProof trust root",
  };
}

function envelope(root: string): SoloInteropEnvelope {
  const candidate = git(root, ["rev-parse", "HEAD"]);
  return {
    schema: "proofloop-solo-interop-v1",
    schemaVersion: 1,
    contract: {
      owner: "NodeProof",
      schemaId: "proofloop-solo-interop-v1",
      schemaDigest: SOLO_INTEROP_SCHEMA_DIGEST,
    },
    programId: "solo-program-1",
    goal: {
      goalId: "goal-1",
      loopId: "loop-1",
      text: "Prove the candidate works",
      currentMilestone: "P",
      status: "completed",
      resumeCommand: "npm test",
    },
    repository: {
      repoUrl: "https://github.com/acme/product.git",
      baseCommit: candidate,
      candidateCommit: candidate,
      branch: "main",
      dirty: false,
    },
    actor: {
      actorId: "solo-agent-1",
      role: "agent",
      agentHost: "solo",
    },
    claim: {
      text: "The local product path is ready",
      tier: "local_ready",
      boundary: "product_path",
    },
    receipts: [writeReceipt(root)],
    budget: {
      maxUsd: 10,
      spentUsd: 1,
      maxRuntimeMs: 60_000,
      maxModelCalls: 10,
    },
    sourceVerdict: {
      authority: "advisory",
      status: "advisory_fail",
      reason: "Deliberately contrary advisory verdict",
    },
    timestamps: {
      createdAt: "2026-07-10T10:00:00Z",
      exportedAt: "2026-07-10T10:05:00Z",
    },
  };
}

function writeEnvelope(root: string, value: unknown): string {
  const path = join(root, ".solo", "proofloop-interop.json");
  mkdirSync(join(root, ".solo"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function issueCodes(root: string, value: unknown): string[] {
  return validateSoloInteropEnvelope(value, { root }).issues.map((issue) => issue.code);
}

describe("ProofLoop/Solo interop", () => {
  it("uses the canonical JSON schema digest and records the raw file hash only as a diagnostic", () => {
    const root = tempRepo();
    const value = envelope(root);
    const validation = validateSoloInteropEnvelope(value, { root });

    expect(validation.ok).toBe(true);
    expect(validation.localCanonicalSchemaDigest).toBe(SOLO_INTEROP_SCHEMA_DIGEST);
    expect(validation.localSchemaFileSha256).toBe(digest(readFileSync(join(__dirname, "..", "schemas", "proofloop-solo-interop-v1.schema.json"))));
    expect(SOLO_INTEROP_SCHEMA_FILE_SHA256).toBe("92f6f24a56f6e31e5d521f09b625d8714370ffa68ea094d340710c715fc901f2");

    value.contract.schemaDigest = SOLO_INTEROP_SCHEMA_FILE_SHA256;
    expect(issueCodes(root, value)).toContain("schema_digest_mismatch");
  });

  it("derives a passing NodeProof status from required evidence and ignores a contrary advisory source verdict", () => {
    const root = tempRepo();
    const value = envelope(root);
    const file = writeEnvelope(root, value);
    const soloBefore = readFileSync(join(root, value.receipts[0].path), "utf8");

    const result = ingestSoloInterop({ root, filePath: file, now: () => new Date("2026-07-10T11:00:00Z") });

    expect(result.receipt.status).toBe("passed");
    expect(result.receipt.accepted).toBe(true);
    expect(result.receipt.authority).toBe("NodeProof");
    expect(result.receipt.sourceVerdict).toEqual({ authority: "advisory", status: "advisory_fail" });
    expect(result.envelopePath).toBe(soloInteropEnvelopePath(root));
    expect(result.receiptPath).toBe(soloInteropReceiptPath(root));
    expect(relative(root, result.envelopePath).replace(/\\/g, "/")).toMatch(/^\.proofloop\/interop\/solo\//);
    expect(readFileSync(join(root, value.receipts[0].path), "utf8")).toBe(soloBefore);
  });

  it("rejects unknown fields, forged authority, unsafe paths, and invalid IDs before reading evidence", () => {
    const root = tempRepo();

    const unknown = envelope(root) as SoloInteropEnvelope & { authoritativeVerdict?: boolean };
    unknown.authoritativeVerdict = true;
    expect(issueCodes(root, unknown)).toContain("unknown_field");

    const forged = envelope(root) as unknown as { sourceVerdict: { authority: string; status: string } };
    forged.sourceVerdict.authority = "NodeProof";
    expect(issueCodes(root, forged)).toContain("invalid_constant");

    const traversal = envelope(root);
    traversal.receipts[0].path = "../outside.json";
    expect(issueCodes(root, traversal)).toContain("unsafe_relative_path");

    const invalidId = envelope(root);
    invalidId.goal.goalId = "../goal";
    expect(issueCodes(root, invalidId)).toContain("invalid_id");
  });

  it("rejects receipt paths containing symbolic-link components", () => {
    const root = tempRepo();
    const value = envelope(root);
    const realDirectory = join(root, ".solo", "real-receipt");
    const linkedDirectory = join(root, ".solo", "linked-receipt");
    mkdirSync(realDirectory, { recursive: true });
    const body = "{\"ok\":true}\n";
    writeFileSync(join(realDirectory, "proof.json"), body, "utf8");
    try {
      symlinkSync(realDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EPERM") return;
      throw cause;
    }
    value.receipts[0].path = ".solo/linked-receipt/proof.json";
    value.receipts[0].sha256 = digest(body);

    expect(issueCodes(root, value)).toContain("invalid_receipt_file");
  });

  it("fails closed for missing or tampered required receipts and rechecks evidence at gate time", () => {
    const root = tempRepo();
    const value = envelope(root);
    const file = writeEnvelope(root, value);
    const logs: string[] = [];
    const errors: string[] = [];

    expect(runSoloInteropCli({ root, subcommand: "ingest", filePath: file, log: (line) => logs.push(line), logError: (line) => errors.push(line) })).toBe(0);
    writeFileSync(join(root, value.receipts[0].path), "tampered\n", "utf8");
    expect(runSoloInteropCli({ root, subcommand: "gate", log: (line) => logs.push(line), logError: (line) => errors.push(line) })).toBe(1);
    expect(JSON.parse(readFileSync(soloInteropReceiptPath(root), "utf8")) as { status: string }).toMatchObject({ status: "rejected" });
    expect(errors.join("\n")).toContain("receipt_digest_mismatch");

    const missing = envelope(root);
    missing.receipts[0].path = ".solo/missing.json";
    missing.receipts[0].sha256 = "a".repeat(64);
    expect(issueCodes(root, missing)).toContain("required_receipt_missing");
  });

  it("rejects a stale candidate commit, including when HEAD advances after ingest", () => {
    const root = tempRepo();
    const value = envelope(root);
    const file = writeEnvelope(root, value);
    expect(ingestSoloInterop({ root, filePath: file }).receipt.status).toBe("passed");

    writeFileSync(join(root, "app.txt"), "candidate v2\n", "utf8");
    git(root, ["add", "app.txt"]);
    git(root, ["commit", "-qm", "next candidate"]);

    const errors: string[] = [];
    expect(runSoloInteropCli({ root, subcommand: "gate", log: () => {}, logError: (line) => errors.push(line) })).toBe(1);
    expect(errors.join("\n")).toContain("stale_candidate_commit");
  });

  it("accepts a separate evidence-only promotion commit but rejects product changes in that commit", () => {
    const root = tempRepo();
    const value = envelope(root);
    mkdirSync(join(root, ".solo"), { recursive: true });
    writeFileSync(join(root, ".solo", "proofloop-interop.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    git(root, ["add", "-f", ".solo/proofloop-interop.json", value.receipts[0].path]);
    git(root, ["commit", "-qm", "attach proof evidence"]);

    expect(validateSoloInteropEnvelope(value, { root }).ok).toBe(true);

    writeFileSync(join(root, "app.txt"), "candidate changed with evidence\n", "utf8");
    git(root, ["add", "app.txt"]);
    git(root, ["commit", "-qm", "change product after evidence"]);
    expect(issueCodes(root, value)).toContain("stale_candidate_commit");
  });

  it("does not let a source file become evidence-only by labeling it as a receipt", () => {
    const root = tempRepo();
    const value = envelope(root);
    writeFileSync(join(root, "app.txt"), "changed product disguised as evidence\n", "utf8");
    const body = readFileSync(join(root, "app.txt"));
    value.receipts.push({
      id: "disguised-product",
      kind: "receipt",
      path: "app.txt",
      sha256: digest(body),
      producer: "attacker",
      createdAt: "2026-07-10T10:00:00Z",
      visibility: "private",
      required: true,
    });
    writeFileSync(join(root, ".solo", "proofloop-interop.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    git(root, ["add", "app.txt"]);
    git(root, ["add", "-f", ".solo/proofloop-interop.json"]);
    git(root, ["commit", "-qm", "attempt receipt relabel bypass"]);

    expect(issueCodes(root, value)).toContain("stale_candidate_commit");
  });

  it("rejects uncommitted product changes while allowing local proof-state writes", () => {
    const root = tempRepo();
    const value = envelope(root);
    writeFileSync(join(root, ".solo", "events.jsonl"), "{}\n", "utf8");
    expect(validateSoloInteropEnvelope(value, { root }).ok).toBe(true);

    writeFileSync(join(root, "app.txt"), "uncommitted product change\n", "utf8");
    expect(issueCodes(root, value)).toContain("dirty_candidate_worktree");
  });

  it("validates actual and projected budgets while preserving an explicit budget blocker", () => {
    const root = tempRepo();

    const overrun = envelope(root);
    overrun.budget.spentUsd = 11;
    expect(issueCodes(root, overrun)).toContain("budget_overrun");

    const projected = envelope(root);
    projected.handoff = {
      mode: "advisory",
      tasks: [{ id: "expensive", milestone: "H", command: "npm test", estimatedCostUsd: 10 }],
    };
    expect(issueCodes(root, projected)).toContain("handoff_budget_overrun");

    const blocked = envelope(root);
    blocked.goal.status = "blocked";
    blocked.blockers = [{ kind: "budget", message: "More budget is required", nextAction: "Approve another $5" }];
    blocked.handoff = projected.handoff;
    const validation = validateSoloInteropEnvelope(blocked, { root });
    expect(validation.ok).toBe(true);
    expect(validation.issues.map((issue) => issue.code)).toContain("handoff_exceeds_remaining_budget");
    const result = ingestSoloInterop({ root, filePath: writeEnvelope(root, blocked) });
    expect(result.receipt.status).toBe("blocked");
    expect(result.receipt.nextActions).toEqual(["Approve another $5"]);
  });

  it("rejects inconsistent blocker state, duplicate IDs, unknown dependencies, and cyclic task graphs", () => {
    const root = tempRepo();

    const inconsistent = envelope(root);
    inconsistent.blockers = [{ kind: "approval", message: "Review needed", nextAction: "Approve it" }];
    expect(issueCodes(root, inconsistent)).toContain("blockers_without_blocked_goal");

    const duplicateReceipt = envelope(root);
    duplicateReceipt.receipts.push({ ...duplicateReceipt.receipts[0] });
    expect(issueCodes(root, duplicateReceipt)).toContain("duplicate_receipt_id");

    const duplicateTask = envelope(root);
    duplicateTask.handoff = {
      mode: "advisory",
      tasks: [
        { id: "same", milestone: "R", command: "npm test", estimatedCostUsd: 0 },
        { id: "same", milestone: "P", command: "npm test", estimatedCostUsd: 0 },
      ],
    };
    expect(issueCodes(root, duplicateTask)).toContain("duplicate_task_id");

    const cycle = envelope(root);
    cycle.handoff = {
      mode: "advisory",
      tasks: [
        { id: "one", milestone: "R", command: "npm test", estimatedCostUsd: 0, dependsOn: ["two"] },
        { id: "two", milestone: "P", command: "npm test", estimatedCostUsd: 0, dependsOn: ["one"] },
      ],
    };
    expect(issueCodes(root, cycle)).toContain("cyclic_task_graph");

    cycle.handoff.tasks[0].dependsOn = ["missing"];
    expect(issueCodes(root, cycle)).toContain("unknown_task_dependency");
  });

  it("requires the correct independent receipt and boundary for team and certification claims", () => {
    const root = tempRepo();
    const keys = trustKeys();

    const team = envelope(root);
    team.claim.tier = "team_ready";
    expect(issueCodes(root, team)).toContain("missing_nodeproof_ci_receipt");
    team.receipts.push(writeSignedPromotionReceipt(root, team, keys, {
      id: "ci-proof",
      kind: "nodeproof-ci",
      issuerKind: "github-actions",
      priorTier: "local_ready",
    }));
    vi.stubEnv("PROOFLOOP_TRUST_PUBLIC_KEY_PEM", "");
    expect(issueCodes(root, team)).toContain("trust_public_key_missing");
    vi.stubEnv("PROOFLOOP_TRUST_PUBLIC_KEY_PEM", keys.publicKeyPem);
    vi.stubEnv("PROOFLOOP_TRUST_KEY_ID", "test-trust-key");
    expect(validateSoloInteropEnvelope(team, { root }).ok).toBe(true);
    vi.stubEnv("PROOFLOOP_TRUST_KEY_ID", "retired-key");
    expect(issueCodes(root, team)).toContain("invalid_trust_receipt");
    vi.stubEnv("PROOFLOOP_TRUST_KEY_ID", "test-trust-key");
    team.repository.repoUrl = "https://github.com/other/product.git";
    expect(issueCodes(root, team)).toContain("invalid_trust_receipt");
    team.repository.repoUrl = "https://github.com/acme/product.git";
    team.claim.boundary = "proxy";
    expect(issueCodes(root, team)).toContain("unsupported_claim_boundary");
    expect(issueCodes(root, team)).toContain("trust_boundary_mismatch");

    const certification = envelope(root);
    certification.claim.tier = "certification_ready";
    certification.claim.boundary = "product_path";
    certification.receipts.push(writeSignedPromotionReceipt(root, certification, keys, {
      id: "hosted-proof",
      kind: "hosted-trust-root",
      issuerKind: "hosted-worker",
      priorTier: "team_ready",
    }));
    expect(validateSoloInteropEnvelope(certification, { root }).ok).toBe(true);
    certification.claim.boundary = "proxy";
    expect(issueCodes(root, certification)).toContain("unsupported_claim_boundary");

    certification.claim.boundary = "official";
    certification.evaluation = {
      candidateProducedAt: "2026-07-10T10:00:00Z",
      evaluatorAccessedAt: "2026-07-10T10:01:00Z",
      scorer: {
        kind: "official",
        name: "official-held-out-scorer",
        version: "1.0.0",
        digest: "b".repeat(64),
      },
    };
    certification.receipts = certification.receipts.filter((receipt) => receipt.kind !== "hosted-trust-root");
    certification.receipts.push(writeSignedPromotionReceipt(root, certification, keys, {
      id: "official-hosted-proof",
      kind: "hosted-trust-root",
      issuerKind: "hosted-worker",
      priorTier: "team_ready",
    }));
    expect(validateSoloInteropEnvelope(certification, { root }).ok).toBe(true);

    certification.evaluation.evaluatorAccessedAt = "2026-07-10T09:59:00Z";
    expect(issueCodes(root, certification)).toContain("scorer_order");
    certification.evaluation.evaluatorAccessedAt = "2026-07-10T10:01:00Z";
    certification.evaluation.scorer = { kind: "equivalent_judge", name: "proxy", version: "1", digest: "b".repeat(64) };
    expect(issueCodes(root, certification)).toContain("unsupported_official_claim");
  });

  it("rejects forged promotion JSON and a valid signature from the wrong issuer", () => {
    const root = tempRepo();
    const keys = trustKeys();
    vi.stubEnv("PROOFLOOP_TRUST_PUBLIC_KEY_PEM", keys.publicKeyPem);
    vi.stubEnv("PROOFLOOP_TRUST_KEY_ID", "test-trust-key");

    const forged = envelope(root);
    forged.claim.tier = "team_ready";
    const forgedPath = join(root, ".solo", "forged-ci.json");
    const forgedBody = `${JSON.stringify({
      schema: "proofloop-solo-trust-root-receipt-v1",
      algorithm: "Ed25519",
      keyId: "forged",
      payload: {
        schema: "proofloop-solo-trust-payload-v1",
        issuedAt: "2026-07-10T10:00:00Z",
        programId: forged.programId,
        goalId: forged.goal.goalId,
        candidateCommit: forged.repository.candidateCommit,
        claimTier: "local_ready",
        boundary: "product_path",
        envelopeSha256: "a".repeat(64),
        gateReceiptSha256: "b".repeat(64),
        gateStatus: "passed",
        issuer: { kind: "github-actions", repository: "acme/product", workflow: "fake", runId: "1", runAttempt: "1", actor: "forger" },
      },
      signature: Buffer.from("not-a-signature").toString("base64"),
    }, null, 2)}\n`;
    writeFileSync(forgedPath, forgedBody, "utf8");
    forged.receipts.push({
      id: "forged-ci",
      kind: "nodeproof-ci",
      path: ".solo/forged-ci.json",
      sha256: digest(forgedBody),
      producer: "attacker",
      createdAt: "2026-07-10T10:00:00Z",
      visibility: "team",
      required: true,
    });
    expect(issueCodes(root, forged)).toContain("invalid_trust_receipt");

    const wrongIssuer = envelope(root);
    wrongIssuer.claim.tier = "certification_ready";
    wrongIssuer.receipts.push(writeSignedPromotionReceipt(root, wrongIssuer, keys, {
      id: "wrong-hosted-issuer",
      kind: "hosted-trust-root",
      issuerKind: "github-actions",
      priorTier: "team_ready",
    }));
    expect(issueCodes(root, wrongIssuer)).toContain("trust_issuer_mismatch");
  });

  it("does not promote an advisory pass without required evidence", () => {
    const root = tempRepo();
    const value = envelope(root);
    value.receipts = [];
    value.sourceVerdict.status = "advisory_pass";

    const validation = validateSoloInteropEnvelope(value, { root });
    expect(validation.ok).toBe(true);
    const result = ingestSoloInterop({ root, filePath: writeEnvelope(root, value) });
    expect(result.receipt.status).toBe("incomplete");
    expect(result.receipt.nextActions.join("\n")).toContain("required, digest-verified receipt");
  });

  it("compiles handoff tasks into dependency order without executing them", () => {
    const root = tempRepo();
    const value = envelope(root);
    const sentinel = join(root, "executed.txt");
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`)}`;
    value.handoff = {
      mode: "advisory",
      tasks: [
        { id: "publish", milestone: "H", command, estimatedCostUsd: 0.3, dependsOn: ["verify"], requiredReceiptIds: [value.receipts[0].id] },
        { id: "build", milestone: "A", command, cwd: ".", estimatedCostUsd: 0.1 },
        { id: "verify", milestone: "P", command, estimatedCostUsd: 0.2, timeoutMs: 5000, dependsOn: ["build"] },
      ],
    };

    const validation = validateSoloInteropEnvelope(value, { root });
    expect(validation.ok).toBe(true);
    expect(compileSoloHandoffRunnerPlan(validation).tasks.map((task) => task.id)).toEqual(["build", "verify", "publish"]);

    const result = ingestSoloInterop({ root, filePath: writeEnvelope(root, value), writeRunnerPlan: true });
    expect(result.receipt.status).toBe("passed");
    expect(result.runnerPlanPath && existsSync(result.runnerPlanPath)).toBe(true);
    expect(existsSync(sentinel)).toBe(false);
    const plan = JSON.parse(readFileSync(result.runnerPlanPath!, "utf8")) as ProofloopRunnerPlan;
    expect(plan).toEqual({
      schema: "proofloop-runner-plan-v1",
      tasks: [
        { id: "build", command, cwd: ".", estimatedCostUsd: 0.1 },
        { id: "verify", command, estimatedCostUsd: 0.2, timeoutMs: 5000 },
        { id: "publish", command, estimatedCostUsd: 0.3 },
      ],
    });
    expect(readRunnerPlan(result.runnerPlanPath!).tasks.map((task) => task.id)).toEqual(["build", "verify", "publish"]);
  });

  it("wires ingest, status, gate, and resume through the public CLI", async () => {
    const root = tempRepo();
    const file = writeEnvelope(root, envelope(root));
    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => output.push(String(value)));
    vi.spyOn(console, "error").mockImplementation((value?: unknown) => errors.push(String(value)));

    expect(await runCli(["solo", "ingest", "--dir", root, "--file", file, "--json"])).toBe(0);
    expect(await runCli(["solo", "status", "--dir", root, "--json"])).toBe(0);
    expect(await runCli(["solo", "gate", "--dir", root, "--json"])).toBe(0);
    expect(await runCli(["solo", "resume", "--dir", root, "--json"])).toBe(0);
    expect(output.join("\n")).toContain('"authority": "NodeProof"');
    expect(output.join("\n")).toContain('"nextActions": []');
    expect(errors).toEqual([]);
  });

  it("wires trust attestation and verification without printing PEM material", async () => {
    const root = tempRepo();
    const value = envelope(root);
    const envelopeFile = writeEnvelope(root, value);
    const gate = ingestSoloInterop({ root, filePath: envelopeFile });
    const keys = trustKeys();
    const publicKeyFile = join(root, "trust-public.pem");
    const trustFile = join(root, "trust-receipt.json");
    writeFileSync(publicKeyFile, keys.publicKeyPem, "utf8");
    vi.stubEnv("PROOFLOOP_TRUST_PRIVATE_KEY_PEM", keys.privateKeyPem);
    vi.stubEnv("GITHUB_ACTIONS", "false");
    vi.stubEnv("GITHUB_REPOSITORY", "acme/product");
    vi.stubEnv("GITHUB_WORKFLOW", "proofloop-gate");
    vi.stubEnv("GITHUB_RUN_ID", "987");
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
    vi.stubEnv("GITHUB_ACTOR", "verifier");
    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((entry?: unknown) => output.push(String(entry)));
    vi.spyOn(console, "error").mockImplementation((entry?: unknown) => errors.push(String(entry)));

    const attestArgs = [
      "solo", "attest", "--dir", root,
      "--file", envelopeFile,
      "--gate-receipt", gate.receiptPath,
      "--out", trustFile,
      "--key-id", "ci-key-1",
      "--json",
    ];
    expect(await runCli(attestArgs)).toBe(1);
    expect(existsSync(trustFile)).toBe(false);
    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(await runCli([
      ...attestArgs,
    ])).toBe(0);
    expect(existsSync(trustFile)).toBe(true);
    expect(await runCli([
      "solo", "verify-attestation", "--dir", root,
      "--file", trustFile,
      "--public-key-file", publicKeyFile,
      "--key-id", "ci-key-1",
      "--candidate", value.repository.candidateCommit,
      "--repository", "acme/product",
      "--json",
    ])).toBe(0);
    vi.stubEnv("PROOFLOOP_TRUST_PUBLIC_KEY_PEM", keys.publicKeyPem);
    expect(await runCli([
      "solo", "verify-attestation", "--dir", root,
      "--file", trustFile,
      "--key-id", "ci-key-1",
      "--candidate", value.repository.candidateCommit,
      "--repository", "acme/product",
    ])).toBe(0);
    expect(await runCli([
      "solo", "verify-attestation", "--dir", root,
      "--file", trustFile,
      "--public-key-file", publicKeyFile,
      "--candidate", "f".repeat(40),
    ])).toBe(1);
    const rendered = `${output.join("\n")}\n${errors.join("\n")}`;
    expect(rendered).not.toContain("PRIVATE KEY");
    expect(rendered).not.toContain("PUBLIC KEY");
    expect(errors.join("\n")).toContain("candidate commit mismatch");
  });
});
