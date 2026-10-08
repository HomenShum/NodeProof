import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import {
  PROOFLOOP_RECEIPT_SCHEMA,
  canonicalJson,
  createInlineProofReceiptPayload,
  createInlineProofReceiptResource,
  proofReceiptSchemaPath,
  readProofReceiptSchema,
  sha256CanonicalJson,
  validateProofReceiptEnvelope,
  verifyProofReceiptEnvelopeFile,
  type ProofReceiptEnvelope,
} from "../src/proofReceipt";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "receipts", "proofloop-receipt-v1");
const SCHEMA_DIGEST = "26b28b9453b31350261737671c48e5dc2adbc30da8886d7f7e74bd8cb52a1e36";
const VALID_FIXTURES = [
  "valid-gate.json",
  "valid-solo-advisory.json",
  "valid-hosted-informational.json",
  "valid-ui-qa.json",
  "valid-official-eval.json",
];
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), "utf8"));
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-receipt-envelope-"));
  tempRoots.push(root);
  return root;
}

describe("proofloop.receipt/v1", () => {
  it("exports the packaged JSON Schema with the authority boundary", () => {
    const schema = readProofReceiptSchema() as Record<string, unknown>;
    const text = JSON.stringify(schema);

    expect(proofReceiptSchemaPath()).toContain("schemas");
    expect(schema.$id).toBe("https://nodeproof.dev/schemas/proofloop-receipt-v1.schema.json");
    expect(createHash("sha256").update(JSON.stringify(schema)).digest("hex")).toBe(SCHEMA_DIGEST);
    expect(text).toContain(PROOFLOOP_RECEIPT_SCHEMA);
    expect(text).toContain("deterministic_gate");
    expect(text).toContain("official_scorer");
    expect(text).toContain("Wrapped payloads never transfer verdict authority implicitly");
  });

  it.each(VALID_FIXTURES)("accepts conformance fixture %s", (name) => {
    const result = validateProofReceiptEnvelope(fixture(name));
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a model judge promoted to authoritative", () => {
    const result = validateProofReceiptEnvelope(fixture("invalid-authoritative-model-judge.json"));

    expect(result.ok).toBe(false);
    expect(result.errors.some((entry) => entry.code === "authority_violation")).toBe(true);
  });

  it("rejects an authoritative pass when a decisive check failed", () => {
    const result = validateProofReceiptEnvelope(fixture("invalid-pass-with-failed-check.json"));

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "verdict_mismatch" }));
  });

  it("rejects an official scorer without immutable scorer identity", () => {
    const result = validateProofReceiptEnvelope(fixture("invalid-official-scorer-without-digest.json"));

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "missing_scorer_digest" }));
  });

  it("hashes inline payloads and evidence with stable sorted-key canonical JSON", () => {
    const left = { z: 1, a: { y: true, b: [2, 1] } };
    const right = { a: { b: [2, 1], y: true }, z: 1 };
    const payload = createInlineProofReceiptPayload("example.payload/v1", left, 1);
    const evidence = createInlineProofReceiptResource({ id: "example-evidence", kind: "example", inline: right });

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(payload.sha256).toBe(sha256CanonicalJson(right));
    expect(evidence.sha256).toBe(payload.sha256);
  });

  it("verifies referenced payload and evidence bytes and fails after tampering", () => {
    const root = tempRoot();
    const payloadText = "{\n  \"schema\": \"legacy-gate-v1\",\n  \"status\": \"passed\"\n}\n";
    const evidenceText = "command=npm test\nexitCode=0\n";
    writeFileSync(join(root, "legacy-gate.json"), payloadText, "utf8");
    writeFileSync(join(root, "gate-output.txt"), evidenceText, "utf8");
    const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    const envelope: ProofReceiptEnvelope = {
      schema: PROOFLOOP_RECEIPT_SCHEMA,
      schemaVersion: 1,
      receiptId: "receipt-reference",
      kind: "gate",
      createdAt: "2026-07-20T00:00:00.000Z",
      producer: { id: "proofloop", version: "0.3.0" },
      subject: { type: "repository", id: "example-repository" },
      verdict: {
        status: "passed",
        authority: "authoritative",
        decisionMethod: "deterministic_gate",
        decisiveCheckIds: ["gate"],
        summary: "The referenced deterministic gate passed.",
      },
      checks: [{
        id: "gate",
        status: "passed",
        role: "decisive",
        method: "deterministic",
        summary: "The command exited 0.",
        evidenceRefs: ["gate-output"],
        exitCode: 0,
      }],
      evidence: [{
        id: "gate-output",
        kind: "command-output",
        path: "gate-output.txt",
        sha256: hash(evidenceText),
        hashMethod: "raw-bytes-sha256",
      }],
      payload: {
        schema: "legacy-gate-v1",
        version: 1,
        mode: "reference",
        ref: "legacy-gate.json",
        sha256: hash(payloadText),
        hashMethod: "raw-bytes-sha256",
      },
    };
    const receiptPath = join(root, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(envelope, null, 2), "utf8");

    expect(verifyProofReceiptEnvelopeFile({ root, filePath: receiptPath }).ok).toBe(true);

    writeFileSync(join(root, "gate-output.txt"), `${evidenceText}tampered=true\n`, "utf8");
    const tampered = verifyProofReceiptEnvelopeFile({ root, filePath: receiptPath });
    expect(tampered.ok).toBe(false);
    expect(tampered.errors).toContainEqual(expect.objectContaining({ code: "hash_mismatch" }));
  });

  it("exposes schema discovery and envelope verification through the CLI", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (message?: unknown) => messages.push(String(message));
      expect(runCli(["receipt", "schema"])).toBe(0);
      expect(runCli(["receipt", "envelope", "verify", "--file", join(FIXTURE_ROOT, "valid-gate.json"), "--json"])).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(messages.join("\n")).toContain("proofloop-receipt-v1.schema.json");
    expect(messages.join("\n")).toContain("\"ok\": true");
  });
});
