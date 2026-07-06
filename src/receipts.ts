import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ReceiptKind = "nodeagent-ingestion";

export interface ReceiptCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReceiptVerification {
  ok: boolean;
  kind: ReceiptKind;
  receiptPath: string;
  checks: ReceiptCheck[];
  summary: {
    documentsCreated?: number;
    memoryObjectsCreated?: number;
    failedSources?: number;
    failedChunks?: number;
  };
}

export interface VerifyReceiptFileOptions {
  root: string;
  filePath: string;
  kind?: ReceiptKind;
  minDocuments?: number;
  minMemoryObjects?: number;
}

type UnknownRecord = Record<string, unknown>;

const NODEAGENT_INGESTION_TYPE = "noderoom.nodeagent.document-ingestion.receipt";

export function verifyReceiptFile(options: VerifyReceiptFileOptions): ReceiptVerification {
  const receiptPath = isAbsolute(options.filePath)
    ? options.filePath
    : resolve(options.root, options.filePath);
  const kind = options.kind ?? "nodeagent-ingestion";
  const checks: ReceiptCheck[] = [];

  if (!existsSync(receiptPath)) {
    return {
      ok: false,
      kind,
      receiptPath,
      checks: [{ name: "receipt_exists", ok: false, detail: "receipt file does not exist" }],
      summary: {},
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      kind,
      receiptPath,
      checks: [{ name: "receipt_json", ok: false, detail: error instanceof Error ? error.message : String(error) }],
      summary: {},
    };
  }

  if (kind !== "nodeagent-ingestion") {
    checks.push({ name: "kind_supported", ok: false, detail: `unsupported kind ${kind}` });
    return { ok: false, kind, receiptPath, checks, summary: {} };
  }

  const receipt = asRecord(parsed);
  const documentPool = asRecord(receipt?.documentPool);
  const memoryPool = asRecord(receipt?.memoryPool);
  const proof = asRecord(receipt?.proof);
  const config = asRecord(receipt?.config);
  const stageOrder = Array.isArray(proof?.stageOrder) ? proof.stageOrder : [];
  const documentHashes = Array.isArray(proof?.documentHashes) ? proof.documentHashes : [];
  const memoryObjectKeys = Array.isArray(proof?.memoryObjectKeys) ? proof.memoryObjectKeys : [];
  const documentsCreated = numberValue(documentPool?.documentsCreated);
  const memoryObjectsCreated = numberValue(memoryPool?.memoryObjectsCreated);
  const failedSources = numberValue(documentPool?.failedSources);
  const failedChunks = numberValue(memoryPool?.failedChunks);
  const minDocuments = options.minDocuments ?? 1;
  const minMemoryObjects = options.minMemoryObjects ?? 1;

  checks.push({
    name: "receipt_type",
    ok: receipt?.type === NODEAGENT_INGESTION_TYPE,
    detail: `expected ${NODEAGENT_INGESTION_TYPE}`,
  });
  checks.push({
    name: "receipt_version",
    ok: receipt?.version === 1,
    detail: "expected version 1",
  });
  checks.push({
    name: "receipt_ok",
    ok: receipt?.ok === true,
    detail: "receipt ok must be true",
  });
  checks.push({
    name: "generated_at",
    ok: typeof receipt?.generatedAt === "string" && !Number.isNaN(Date.parse(receipt.generatedAt)),
    detail: "generatedAt must be an ISO-like timestamp",
  });
  checks.push({
    name: "stage_order",
    ok: stageOrder.length === 2 && stageOrder[0] === "document_pool" && stageOrder[1] === "memory_pool",
    detail: "expected document_pool -> memory_pool",
  });
  checks.push({
    name: "document_count",
    ok: documentsCreated >= minDocuments,
    detail: `documentsCreated ${documentsCreated} >= ${minDocuments}`,
  });
  checks.push({
    name: "memory_object_count",
    ok: memoryObjectsCreated >= minMemoryObjects,
    detail: `memoryObjectsCreated ${memoryObjectsCreated} >= ${minMemoryObjects}`,
  });
  checks.push({
    name: "document_hashes",
    ok: documentHashes.length === documentsCreated && documentHashes.every((value) => typeof value === "string" && value.length > 0),
    detail: "documentHashes must match documentsCreated",
  });
  checks.push({
    name: "memory_object_keys",
    ok: memoryObjectKeys.length === memoryObjectsCreated && memoryObjectKeys.every((value) => typeof value === "string" && value.length > 0),
    detail: "memoryObjectKeys must match memoryObjectsCreated",
  });
  checks.push({
    name: "failures_zero",
    ok: failedSources === 0 && failedChunks === 0,
    detail: `failedSources=${failedSources} failedChunks=${failedChunks}`,
  });
  checks.push({
    name: "batch_config",
    ok:
      positiveInteger(config?.documentShardSize) &&
      positiveInteger(config?.documentBatchSize) &&
      positiveInteger(config?.memoryBatchSize) &&
      positiveInteger(config?.documentWorkerConcurrency) &&
      positiveInteger(config?.memoryWorkerConcurrency),
    detail: "batch sizes and worker concurrency must be positive integers",
  });

  return {
    ok: checks.every((check) => check.ok),
    kind,
    receiptPath,
    checks,
    summary: {
      documentsCreated,
      memoryObjectsCreated,
      failedSources,
      failedChunks,
    },
  };
}

export function formatReceiptVerification(result: ReceiptVerification): string {
  const lines = [
    `receipt=${result.kind}`,
    `path=${result.receiptPath}`,
    `status=${result.ok ? "passed" : "failed"}`,
    `documents=${result.summary.documentsCreated ?? 0}`,
    `memoryObjects=${result.summary.memoryObjectsCreated ?? 0}`,
    "checks:",
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  return `${lines.join("\n")}\n`;
}

export function runReceiptVerify(options: VerifyReceiptFileOptions & { json?: boolean; log?: (message: string) => void; logError?: (message: string) => void }): number {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const result = verifyReceiptFile(options);

  if (options.json === true) {
    log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    log(formatReceiptVerification(result));
  } else {
    logError(formatReceiptVerification(result));
  }

  return result.ok ? 0 : 1;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
