import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSoloTrustReceipt, verifySoloTrustReceipt } from "../src/soloTrust";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "proofloop-solo-trust-"));
  roots.push(root);
  const envelopePath = join(root, "envelope.json");
  const gateReceiptPath = join(root, "gate.json");
  writeFileSync(envelopePath, JSON.stringify({
    schema: "proofloop-solo-interop-v1",
    programId: "program-1",
    goal: { goalId: "goal-1" },
    repository: { candidateCommit: "a".repeat(40) },
    claim: { tier: "certification_ready", boundary: "product_path" },
  }), "utf8");
  writeFileSync(gateReceiptPath, JSON.stringify({
    status: "passed",
    repository: { candidateCommit: "a".repeat(40) },
  }), "utf8");
  const pair = generateKeyPairSync("ed25519");
  return {
    root,
    envelopePath,
    gateReceiptPath,
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("Solo hosted trust attestation", () => {
  it("signs an independently derived passing gate and verifies exact provenance", () => {
    const fx = fixture();
    const outPath = join(fx.root, "trust.json");
    const receipt = createSoloTrustReceipt({
      ...fx,
      keyId: "proofloop-ci-2026",
      outPath,
      now: "2026-07-10T12:00:00.000Z",
      environment: {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "acme/product",
        GITHUB_WORKFLOW: "proofloop-gate",
        GITHUB_RUN_ID: "1234",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_ACTOR: "reviewer",
      },
    });

    expect(receipt.payload.gateStatus).toBe("passed");
    expect(receipt.payload.candidateCommit).toBe("a".repeat(40));
    expect(receipt.payload.issuer).toMatchObject({ repository: "acme/product", runId: "1234", actor: "reviewer" });
    expect(readFileSync(outPath, "utf8")).not.toContain("PRIVATE KEY");
    expect(verifySoloTrustReceipt(receipt, {
      publicKeyPem: fx.publicKeyPem,
      expectedKeyId: "proofloop-ci-2026",
      expectedCandidateCommit: "a".repeat(40),
      expectedRepository: "acme/product",
      expectedIssuerKind: "github-actions",
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects local signing, non-passing gates, candidate mismatch, and tampering", () => {
    const fx = fixture();
    expect(() => createSoloTrustReceipt({ ...fx, keyId: "key-1", environment: {} })).toThrow(/GitHub Actions/);

    writeFileSync(fx.gateReceiptPath, JSON.stringify({ status: "failed" }), "utf8");
    expect(() => createSoloTrustReceipt({ ...fx, keyId: "key-1", allowLocalTest: true })).toThrow(/non-passing/);

    writeFileSync(fx.gateReceiptPath, JSON.stringify({ status: "passed", candidateCommit: "b".repeat(40) }), "utf8");
    expect(() => createSoloTrustReceipt({ ...fx, keyId: "key-1", allowLocalTest: true })).toThrow(/does not match/);

    writeFileSync(fx.gateReceiptPath, JSON.stringify({ status: "passed", candidateCommit: "a".repeat(40) }), "utf8");
    const receipt = createSoloTrustReceipt({ ...fx, keyId: "key-1", allowLocalTest: true });
    expect(verifySoloTrustReceipt(receipt, { publicKeyPem: fx.publicKeyPem, expectedIssuerKind: "hosted-worker" }).errors).toContain("issuer kind mismatch");
    receipt.payload.goalId = "tampered";
    expect(verifySoloTrustReceipt(receipt, { publicKeyPem: fx.publicKeyPem }).ok).toBe(false);
  });
});
