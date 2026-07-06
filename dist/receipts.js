"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyReceiptFile = verifyReceiptFile;
exports.formatReceiptVerification = formatReceiptVerification;
exports.runReceiptVerify = runReceiptVerify;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const NODEAGENT_INGESTION_TYPE = "noderoom.nodeagent.document-ingestion.receipt";
function verifyReceiptFile(options) {
    const receiptPath = (0, node_path_1.isAbsolute)(options.filePath)
        ? options.filePath
        : (0, node_path_1.resolve)(options.root, options.filePath);
    const kind = options.kind ?? "nodeagent-ingestion";
    const checks = [];
    if (!(0, node_fs_1.existsSync)(receiptPath)) {
        return {
            ok: false,
            kind,
            receiptPath,
            checks: [{ name: "receipt_exists", ok: false, detail: "receipt file does not exist" }],
            summary: {},
        };
    }
    let parsed;
    try {
        parsed = JSON.parse((0, node_fs_1.readFileSync)(receiptPath, "utf8"));
    }
    catch (error) {
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
        ok: positiveInteger(config?.documentShardSize) &&
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
function formatReceiptVerification(result) {
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
function runReceiptVerify(options) {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const result = verifyReceiptFile(options);
    if (options.json === true) {
        log(JSON.stringify(result, null, 2));
    }
    else if (result.ok) {
        log(formatReceiptVerification(result));
    }
    else {
        logError(formatReceiptVerification(result));
    }
    return result.ok ? 0 : 1;
}
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function positiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
