import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { runReceiptVerify, verifyReceiptFile } from "../src/receipts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-receipts-"));
  tempRoots.push(root);
  return root;
}

function writeReceipt(root: string, patch: Record<string, unknown> = {}): string {
  const receipt = {
    type: "noderoom.nodeagent.document-ingestion.receipt",
    version: 1,
    ok: true,
    generatedAt: "2026-07-06T00:00:00.000Z",
    config: {
      documentShardSize: 2,
      documentBatchSize: 2,
      documentWorkerConcurrency: 2,
      memoryBatchSize: 2,
      memoryWorkerConcurrency: 2,
      chunkMaxChars: 120,
      chunkOverlapChars: 20,
    },
    documentPool: {
      documentsCreated: 2,
      failedSources: 0,
    },
    memoryPool: {
      memoryObjectsCreated: 3,
      failedChunks: 0,
    },
    proof: {
      stageOrder: ["document_pool", "memory_pool"],
      documentHashes: ["doc_a", "doc_b"],
      memoryObjectKeys: ["mem_a", "mem_b", "mem_c"],
    },
    ...patch,
  };
  const path = join(root, "receipt.json");
  writeFileSync(path, JSON.stringify(receipt, null, 2), "utf8");
  return path;
}

describe("receipt verification", () => {
  it("passes a valid NodeAgent ingestion receipt", () => {
    const root = tempRoot();
    const path = writeReceipt(root);

    const result = verifyReceiptFile({
      root,
      filePath: path,
      kind: "nodeagent-ingestion",
      minDocuments: 2,
      minMemoryObjects: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.summary.documentsCreated).toBe(2);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it("fails closed when counts or stage order do not satisfy the contract", () => {
    const root = tempRoot();
    const path = writeReceipt(root, {
      proof: {
        stageOrder: ["memory_pool", "document_pool"],
        documentHashes: ["doc_a", "doc_b"],
        memoryObjectKeys: ["mem_a", "mem_b", "mem_c"],
      },
    });

    const result = verifyReceiptFile({
      root,
      filePath: path,
      minDocuments: 3,
      minMemoryObjects: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "stage_order")?.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "document_count")?.ok).toBe(false);
  });

  it("exposes receipt verification through the CLI", () => {
    const root = tempRoot();
    writeReceipt(root);

    const messages: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (message?: unknown) => {
        messages.push(String(message));
      };
      expect(runCli(["--dir", root, "receipt", "verify", "--file", "receipt.json", "--kind", "nodeagent-ingestion", "--json"])).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(messages.join("\n")).toContain("\"ok\": true");
  });

  it("returns exit 1 for a missing receipt file", () => {
    const root = tempRoot();
    const errors: string[] = [];

    expect(
      runReceiptVerify({
        root,
        filePath: "missing.json",
        kind: "nodeagent-ingestion",
        logError: (message) => errors.push(message),
      }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("receipt file does not exist");
  });
});
