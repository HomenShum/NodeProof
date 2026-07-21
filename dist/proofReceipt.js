"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROOFLOOP_RECEIPT_SCHEMA_FILE = exports.PROOFLOOP_RECEIPT_SCHEMA_VERSION = exports.PROOFLOOP_RECEIPT_SCHEMA = void 0;
exports.proofReceiptSchemaPath = proofReceiptSchemaPath;
exports.readProofReceiptSchema = readProofReceiptSchema;
exports.canonicalJson = canonicalJson;
exports.sha256Utf8 = sha256Utf8;
exports.sha256CanonicalJson = sha256CanonicalJson;
exports.createInlineProofReceiptPayload = createInlineProofReceiptPayload;
exports.createInlineProofReceiptResource = createInlineProofReceiptResource;
exports.validateProofReceiptEnvelope = validateProofReceiptEnvelope;
exports.verifyProofReceiptEnvelopeFile = verifyProofReceiptEnvelopeFile;
exports.formatProofReceiptVerification = formatProofReceiptVerification;
exports.runProofReceiptEnvelopeVerify = runProofReceiptEnvelopeVerify;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.PROOFLOOP_RECEIPT_SCHEMA = "proofloop.receipt/v1";
exports.PROOFLOOP_RECEIPT_SCHEMA_VERSION = 1;
exports.PROOFLOOP_RECEIPT_SCHEMA_FILE = "proofloop-receipt-v1.schema.json";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const KIND_PATTERN = /^[a-z][a-z0-9._/-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const AUTHORITATIVE_METHODS = new Set(["deterministic_gate", "official_scorer"]);
const DECISIVE_CHECK_METHODS = new Set(["deterministic", "official_scorer"]);
const RECEIPT_KEYS = new Set([
    "$schema",
    "schema",
    "schemaVersion",
    "receiptId",
    "kind",
    "createdAt",
    "producer",
    "subject",
    "claim",
    "verdict",
    "checks",
    "evidence",
    "artifacts",
    "payload",
    "lineage",
    "timing",
    "budget",
    "privacy",
    "extensions",
]);
function proofReceiptSchemaPath() {
    return (0, node_path_1.resolve)(__dirname, "..", "schemas", exports.PROOFLOOP_RECEIPT_SCHEMA_FILE);
}
function readProofReceiptSchema() {
    return JSON.parse((0, node_fs_1.readFileSync)(proofReceiptSchemaPath(), "utf8"));
}
function canonicalJson(value) {
    if (value === null)
        return "null";
    if (typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("canonical JSON does not support non-finite numbers");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    throw new Error(`canonical JSON does not support ${typeof value}`);
}
function sha256Utf8(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
function sha256CanonicalJson(value) {
    return sha256Utf8(canonicalJson(value));
}
function createInlineProofReceiptPayload(schema, data, version) {
    return {
        schema,
        ...(version !== undefined ? { version } : {}),
        mode: "inline",
        data,
        sha256: sha256CanonicalJson(data),
        hashMethod: "canonical-json-sha256",
    };
}
function createInlineProofReceiptResource(options) {
    return {
        id: options.id,
        kind: options.kind,
        ...(options.description !== undefined ? { description: options.description } : {}),
        inline: options.inline,
        sha256: sha256CanonicalJson(options.inline),
        hashMethod: "canonical-json-sha256",
        ...(options.mediaType !== undefined ? { mediaType: options.mediaType } : {}),
        ...(options.visibility !== undefined ? { visibility: options.visibility } : {}),
        ...(options.redacted !== undefined ? { redacted: options.redacted } : {}),
    };
}
function validateProofReceiptEnvelope(value) {
    const errors = [];
    const warnings = [];
    const receipt = asRecord(value, "$", errors);
    if (!receipt)
        return { ok: false, errors, warnings };
    for (const key of Object.keys(receipt)) {
        if (!RECEIPT_KEYS.has(key))
            issue(errors, `$.${key}`, "unknown_property", "unknown top-level property");
    }
    expectLiteral(receipt.schema, exports.PROOFLOOP_RECEIPT_SCHEMA, "$.schema", errors);
    expectLiteral(receipt.schemaVersion, exports.PROOFLOOP_RECEIPT_SCHEMA_VERSION, "$.schemaVersion", errors);
    expectPattern(receipt.receiptId, ID_PATTERN, "$.receiptId", errors);
    expectPattern(receipt.kind, KIND_PATTERN, "$.kind", errors);
    expectDateTime(receipt.createdAt, "$.createdAt", errors);
    const producer = asRecord(receipt.producer, "$.producer", errors);
    if (producer) {
        expectPattern(producer.id, ID_PATTERN, "$.producer.id", errors);
        expectNonEmptyString(producer.version, "$.producer.version", errors);
        if (producer.configHash !== undefined)
            expectPattern(producer.configHash, SHA256_PATTERN, "$.producer.configHash", errors);
    }
    const subject = asRecord(receipt.subject, "$.subject", errors);
    if (subject) {
        expectEnum(subject.type, ["repository", "deployment", "run", "workflow", "artifact", "evaluation", "application"], "$.subject.type", errors);
        expectPattern(subject.id, ID_PATTERN, "$.subject.id", errors);
        if (subject.runId !== undefined)
            expectPattern(subject.runId, ID_PATTERN, "$.subject.runId", errors);
        if (subject.artifactId !== undefined)
            expectPattern(subject.artifactId, ID_PATTERN, "$.subject.artifactId", errors);
        if (subject.targetUrl !== undefined)
            expectUri(subject.targetUrl, "$.subject.targetUrl", errors);
        const repository = subject.repository === undefined ? undefined : asRecord(subject.repository, "$.subject.repository", errors);
        if (repository) {
            if (repository.baseCommit !== undefined)
                expectPattern(repository.baseCommit, GIT_SHA_PATTERN, "$.subject.repository.baseCommit", errors);
            if (repository.candidateCommit !== undefined)
                expectPattern(repository.candidateCommit, GIT_SHA_PATTERN, "$.subject.repository.candidateCommit", errors);
        }
    }
    const verdict = asRecord(receipt.verdict, "$.verdict", errors);
    const status = verdict ? expectEnum(verdict.status, ["passed", "failed", "blocked", "incomplete", "error", "unknown"], "$.verdict.status", errors) : undefined;
    const authority = verdict ? expectEnum(verdict.authority, ["authoritative", "advisory", "informational"], "$.verdict.authority", errors) : undefined;
    const decisionMethod = verdict ? expectEnum(verdict.decisionMethod, ["deterministic_gate", "official_scorer", "model_judge", "human_review", "external_claim", "none"], "$.verdict.decisionMethod", errors) : undefined;
    if (verdict)
        expectNonEmptyString(verdict.summary, "$.verdict.summary", errors);
    const decisiveCheckIds = verdict ? stringArray(verdict.decisiveCheckIds, "$.verdict.decisiveCheckIds", errors, true) : [];
    const checkValues = arrayValue(receipt.checks, "$.checks", errors);
    const checks = [];
    const checkIds = new Set();
    for (let index = 0; index < checkValues.length; index += 1) {
        const check = validateCheck(checkValues[index], index, errors);
        if (!check)
            continue;
        if (checkIds.has(check.id))
            issue(errors, `$.checks[${index}].id`, "duplicate_id", `duplicate check id ${check.id}`);
        checkIds.add(check.id);
        checks.push(check);
    }
    const evidenceValues = arrayValue(receipt.evidence, "$.evidence", errors);
    const evidence = [];
    const evidenceIds = new Set();
    for (let index = 0; index < evidenceValues.length; index += 1) {
        const resource = validateResource(evidenceValues[index], `$.evidence[${index}]`, errors);
        if (!resource)
            continue;
        if (evidenceIds.has(resource.id))
            issue(errors, `$.evidence[${index}].id`, "duplicate_id", `duplicate evidence id ${resource.id}`);
        evidenceIds.add(resource.id);
        evidence.push(resource);
    }
    const artifactValues = receipt.artifacts === undefined ? [] : arrayValue(receipt.artifacts, "$.artifacts", errors);
    const artifacts = [];
    const artifactIds = new Set();
    for (let index = 0; index < artifactValues.length; index += 1) {
        const resource = validateResource(artifactValues[index], `$.artifacts[${index}]`, errors);
        if (!resource)
            continue;
        if (artifactIds.has(resource.id))
            issue(errors, `$.artifacts[${index}].id`, "duplicate_id", `duplicate artifact id ${resource.id}`);
        artifactIds.add(resource.id);
        artifacts.push(resource);
    }
    for (const check of checks) {
        for (const evidenceRef of check.evidenceRefs) {
            if (!evidenceIds.has(evidenceRef))
                issue(errors, `$.checks.${check.id}.evidenceRefs`, "missing_evidence", `unknown evidence ref ${evidenceRef}`);
        }
    }
    validatePayload(receipt.payload, errors);
    if (authority === "authoritative") {
        if (!decisionMethod || !AUTHORITATIVE_METHODS.has(decisionMethod)) {
            issue(errors, "$.verdict.decisionMethod", "authority_violation", "authoritative verdicts require a deterministic gate or official scorer");
        }
        if (!status || status === "incomplete" || status === "unknown") {
            issue(errors, "$.verdict.status", "authority_violation", "authoritative verdicts cannot be incomplete or unknown");
        }
        if (decisiveCheckIds.length === 0)
            issue(errors, "$.verdict.decisiveCheckIds", "missing_decisive_check", "authoritative verdicts require at least one decisive check");
        const decisiveIds = new Set(decisiveCheckIds);
        const decisiveChecks = checks.filter((check) => decisiveIds.has(check.id));
        for (const id of decisiveCheckIds) {
            if (!checkIds.has(id))
                issue(errors, "$.verdict.decisiveCheckIds", "missing_check", `unknown decisive check ${id}`);
        }
        for (const check of checks.filter((entry) => entry.role === "decisive")) {
            if (!decisiveIds.has(check.id))
                issue(errors, `$.checks.${check.id}.role`, "unlisted_decisive_check", "decisive checks must be listed in verdict.decisiveCheckIds");
        }
        for (const check of decisiveChecks) {
            if (check.role !== "decisive")
                issue(errors, `$.checks.${check.id}.role`, "authority_violation", "a decisiveCheckId must reference a decisive check");
            if (!DECISIVE_CHECK_METHODS.has(check.method))
                issue(errors, `$.checks.${check.id}.method`, "authority_violation", "model, human, and external checks cannot decide an authoritative verdict");
            if (check.evidenceRefs.length === 0)
                issue(errors, `$.checks.${check.id}.evidenceRefs`, "missing_evidence", "decisive checks require locally verifiable evidence");
            for (const ref of check.evidenceRefs) {
                const resource = evidence.find((entry) => entry.id === ref);
                if (resource?.uri !== undefined)
                    issue(errors, `$.evidence.${ref}.uri`, "unverifiable_decisive_evidence", "URI-only evidence cannot decide an authoritative local verification");
            }
        }
        if (decisionMethod === "deterministic_gate" && decisiveChecks.some((check) => check.method !== "deterministic")) {
            issue(errors, "$.verdict.decisionMethod", "method_mismatch", "deterministic_gate verdicts require every decisive check to be deterministic");
        }
        if (decisionMethod === "official_scorer" && !decisiveChecks.some((check) => check.method === "official_scorer")) {
            issue(errors, "$.verdict.decisionMethod", "method_mismatch", "official_scorer verdicts require an official scorer decisive check");
        }
        if (status === "passed" && decisiveChecks.some((check) => check.status !== "passed")) {
            issue(errors, "$.verdict.status", "verdict_mismatch", "an authoritative pass requires every decisive check to pass");
        }
        if ((status === "failed" || status === "blocked" || status === "error") && !decisiveChecks.some((check) => check.status === status)) {
            issue(errors, "$.verdict.status", "verdict_mismatch", `an authoritative ${status} verdict requires a decisive ${status} check`);
        }
    }
    else if (authority !== undefined) {
        if (decisiveCheckIds.length > 0)
            issue(errors, "$.verdict.decisiveCheckIds", "authority_violation", "non-authoritative receipts cannot declare decisive checks");
        for (const check of checks) {
            if (check.role === "decisive")
                issue(errors, `$.checks.${check.id}.role`, "authority_violation", "non-authoritative receipts may contain advisory checks only");
        }
    }
    if (authority === "informational") {
        if (status !== "incomplete" && status !== "unknown")
            issue(errors, "$.verdict.status", "informational_verdict", "informational receipts must be incomplete or unknown");
        if (decisionMethod !== "none")
            issue(errors, "$.verdict.decisionMethod", "informational_verdict", "informational receipts use decisionMethod none");
    }
    const envelope = errors.length === 0 ? value : undefined;
    return { ok: errors.length === 0, errors, warnings, ...(envelope ? { envelope } : {}) };
}
function verifyProofReceiptEnvelopeFile(options) {
    const receiptPath = (0, node_path_1.isAbsolute)(options.filePath) ? options.filePath : (0, node_path_1.resolve)(options.root, options.filePath);
    if (!(0, node_fs_1.existsSync)(receiptPath)) {
        return {
            ok: false,
            receiptPath,
            errors: [{ path: "$", code: "receipt_missing", message: "receipt file does not exist" }],
            warnings: [],
        };
    }
    let parsed;
    try {
        parsed = JSON.parse((0, node_fs_1.readFileSync)(receiptPath, "utf8"));
    }
    catch (error) {
        return {
            ok: false,
            receiptPath,
            errors: [{ path: "$", code: "receipt_json", message: error instanceof Error ? error.message : String(error) }],
            warnings: [],
        };
    }
    const validation = validateProofReceiptEnvelope(parsed);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const envelope = validation.envelope;
    if (envelope) {
        const baseDir = (0, node_path_1.dirname)(receiptPath);
        verifyPayloadIntegrity(envelope.payload, baseDir, errors);
        for (const resource of [...envelope.evidence, ...(envelope.artifacts ?? [])]) {
            verifyResourceIntegrity(resource, baseDir, errors);
        }
    }
    return {
        ok: errors.length === 0,
        receiptPath,
        errors,
        warnings,
        ...(envelope ? { envelope } : {}),
    };
}
function formatProofReceiptVerification(result) {
    const lines = [
        `schema=${exports.PROOFLOOP_RECEIPT_SCHEMA}`,
        `path=${result.receiptPath}`,
        `status=${result.ok ? "passed" : "failed"}`,
    ];
    if (result.envelope) {
        lines.push(`receiptId=${result.envelope.receiptId}`);
        lines.push(`kind=${result.envelope.kind}`);
        lines.push(`authority=${result.envelope.verdict.authority}`);
        lines.push(`verdict=${result.envelope.verdict.status}`);
    }
    lines.push("checks:");
    if (result.errors.length === 0)
        lines.push("- PASS envelope and local integrity checks");
    for (const error of result.errors)
        lines.push(`- FAIL ${error.path} ${error.code}: ${error.message}`);
    for (const warning of result.warnings)
        lines.push(`- WARN ${warning.path} ${warning.code}: ${warning.message}`);
    return `${lines.join("\n")}\n`;
}
function runProofReceiptEnvelopeVerify(options) {
    const result = verifyProofReceiptEnvelopeFile(options);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    const output = options.json === true ? JSON.stringify(result, null, 2) : formatProofReceiptVerification(result);
    if (result.ok)
        log(output);
    else
        logError(output);
    return result.ok ? 0 : 1;
}
function validateCheck(value, index, errors) {
    const path = `$.checks[${index}]`;
    const check = asRecord(value, path, errors);
    if (!check)
        return undefined;
    const id = expectPattern(check.id, ID_PATTERN, `${path}.id`, errors);
    const status = expectEnum(check.status, ["passed", "failed", "blocked", "error", "skipped", "unknown"], `${path}.status`, errors);
    const role = expectEnum(check.role, ["decisive", "advisory"], `${path}.role`, errors);
    const method = expectEnum(check.method, ["deterministic", "official_scorer", "model_judge", "human_review", "external"], `${path}.method`, errors);
    const summary = expectNonEmptyString(check.summary, `${path}.summary`, errors);
    const evidenceRefs = stringArray(check.evidenceRefs, `${path}.evidenceRefs`, errors, true);
    if (check.durationMs !== undefined)
        expectNonNegativeInteger(check.durationMs, `${path}.durationMs`, errors);
    if (check.exitCode !== undefined && !Number.isInteger(check.exitCode))
        issue(errors, `${path}.exitCode`, "type", "expected an integer");
    if (check.score !== undefined && (typeof check.score !== "number" || !Number.isFinite(check.score)))
        issue(errors, `${path}.score`, "type", "expected a finite number");
    if (check.threshold !== undefined && (typeof check.threshold !== "number" || !Number.isFinite(check.threshold)))
        issue(errors, `${path}.threshold`, "type", "expected a finite number");
    const scorer = check.scorer === undefined ? undefined : asRecord(check.scorer, `${path}.scorer`, errors);
    if (scorer) {
        expectNonEmptyString(scorer.name, `${path}.scorer.name`, errors);
        expectNonEmptyString(scorer.version, `${path}.scorer.version`, errors);
        if (scorer.digest !== undefined)
            expectPattern(scorer.digest, SHA256_PATTERN, `${path}.scorer.digest`, errors);
    }
    if (role === "decisive" && method && !DECISIVE_CHECK_METHODS.has(method))
        issue(errors, `${path}.method`, "authority_violation", "decisive checks must be deterministic or official scorers");
    if (role === "decisive" && evidenceRefs.length === 0)
        issue(errors, `${path}.evidenceRefs`, "missing_evidence", "decisive checks require evidence");
    if (method === "official_scorer") {
        if (!scorer)
            issue(errors, `${path}.scorer`, "missing_scorer", "official scorer checks require scorer identity");
        else if (scorer.digest === undefined)
            issue(errors, `${path}.scorer.digest`, "missing_scorer_digest", "official scorer checks require an immutable scorer digest");
    }
    if (!id || !status || !role || !method || !summary)
        return undefined;
    return {
        id,
        status,
        role,
        method,
        summary,
        evidenceRefs,
        ...(typeof check.durationMs === "number" ? { durationMs: check.durationMs } : {}),
        ...(typeof check.exitCode === "number" ? { exitCode: check.exitCode } : {}),
        ...(typeof check.score === "number" ? { score: check.score } : {}),
        ...(typeof check.threshold === "number" ? { threshold: check.threshold } : {}),
        ...(scorer ? { scorer: check.scorer } : {}),
    };
}
function validateResource(value, path, errors) {
    const resource = asRecord(value, path, errors);
    if (!resource)
        return undefined;
    const id = expectPattern(resource.id, ID_PATTERN, `${path}.id`, errors);
    const kind = expectPattern(resource.kind, KIND_PATTERN, `${path}.kind`, errors);
    const sha256 = expectPattern(resource.sha256, SHA256_PATTERN, `${path}.sha256`, errors);
    const hashMethod = expectEnum(resource.hashMethod, ["raw-bytes-sha256", "canonical-json-sha256", "utf8-sha256"], `${path}.hashMethod`, errors);
    const locators = [resource.path !== undefined, resource.uri !== undefined, Object.prototype.hasOwnProperty.call(resource, "inline")].filter(Boolean).length;
    if (locators !== 1)
        issue(errors, path, "resource_locator", "exactly one of path, uri, or inline is required");
    if (resource.path !== undefined && !safeRelativePath(resource.path))
        issue(errors, `${path}.path`, "relative_path", "expected a safe relative path without parent traversal");
    if (resource.uri !== undefined)
        expectUri(resource.uri, `${path}.uri`, errors);
    if (resource.path !== undefined || resource.uri !== undefined) {
        if (hashMethod && hashMethod !== "raw-bytes-sha256")
            issue(errors, `${path}.hashMethod`, "hash_method", "path and URI resources use raw-bytes-sha256");
    }
    if (Object.prototype.hasOwnProperty.call(resource, "inline")) {
        if (hashMethod === "canonical-json-sha256") {
            try {
                if (sha256 && sha256CanonicalJson(resource.inline) !== sha256)
                    issue(errors, `${path}.sha256`, "hash_mismatch", "inline canonical JSON hash does not match");
            }
            catch (error) {
                issue(errors, `${path}.inline`, "canonical_json", error instanceof Error ? error.message : String(error));
            }
        }
        else if (hashMethod === "utf8-sha256") {
            if (typeof resource.inline !== "string")
                issue(errors, `${path}.inline`, "type", "utf8-sha256 requires an inline string");
            else if (sha256 && sha256Utf8(resource.inline) !== sha256)
                issue(errors, `${path}.sha256`, "hash_mismatch", "inline UTF-8 hash does not match");
        }
        else if (hashMethod !== undefined) {
            issue(errors, `${path}.hashMethod`, "hash_method", "inline resources use canonical-json-sha256 or utf8-sha256");
        }
    }
    if (!id || !kind || !sha256 || !hashMethod)
        return undefined;
    return value;
}
function validatePayload(value, errors) {
    const payload = asRecord(value, "$.payload", errors);
    if (!payload)
        return undefined;
    const schema = expectNonEmptyString(payload.schema, "$.payload.schema", errors);
    const mode = expectEnum(payload.mode, ["inline", "reference"], "$.payload.mode", errors);
    const sha256 = expectPattern(payload.sha256, SHA256_PATTERN, "$.payload.sha256", errors);
    const hashMethod = expectEnum(payload.hashMethod, ["raw-bytes-sha256", "canonical-json-sha256"], "$.payload.hashMethod", errors);
    const hasData = Object.prototype.hasOwnProperty.call(payload, "data");
    const hasRef = payload.ref !== undefined;
    if (mode === "inline") {
        if (!hasData || hasRef)
            issue(errors, "$.payload", "payload_mode", "inline payload requires data and forbids ref");
        if (hashMethod !== "canonical-json-sha256")
            issue(errors, "$.payload.hashMethod", "hash_method", "inline payloads use canonical-json-sha256");
        if (hasData && sha256) {
            try {
                if (sha256CanonicalJson(payload.data) !== sha256)
                    issue(errors, "$.payload.sha256", "hash_mismatch", "inline payload canonical JSON hash does not match");
            }
            catch (error) {
                issue(errors, "$.payload.data", "canonical_json", error instanceof Error ? error.message : String(error));
            }
        }
    }
    else if (mode === "reference") {
        if (!hasRef || hasData)
            issue(errors, "$.payload", "payload_mode", "reference payload requires ref and forbids data");
        if (!safeRelativePath(payload.ref))
            issue(errors, "$.payload.ref", "relative_path", "expected a safe relative path without parent traversal");
        if (hashMethod !== "raw-bytes-sha256")
            issue(errors, "$.payload.hashMethod", "hash_method", "reference payloads use raw-bytes-sha256");
    }
    if (!schema || !mode || !sha256 || !hashMethod)
        return undefined;
    return value;
}
function verifyPayloadIntegrity(payload, baseDir, errors) {
    if (payload.mode === "inline")
        return;
    if (!payload.ref || !safeRelativePath(payload.ref))
        return;
    verifyRelativeFileHash(payload.ref, payload.sha256, baseDir, "$.payload.ref", errors);
}
function verifyResourceIntegrity(resource, baseDir, errors) {
    if (!resource.path || !safeRelativePath(resource.path))
        return;
    verifyRelativeFileHash(resource.path, resource.sha256, baseDir, `$.resources.${resource.id}.path`, errors);
}
function verifyRelativeFileHash(path, expectedHash, baseDir, issuePath, errors) {
    const absolutePath = (0, node_path_1.resolve)(baseDir, path);
    const escaped = (0, node_path_1.relative)(baseDir, absolutePath);
    if (escaped === ".." || escaped.startsWith(`..${node_path_1.sep}`) || (0, node_path_1.isAbsolute)(escaped)) {
        issue(errors, issuePath, "path_escape", "referenced file escapes the receipt directory");
        return;
    }
    if (!(0, node_fs_1.existsSync)(absolutePath)) {
        issue(errors, issuePath, "referenced_file_missing", `referenced file does not exist: ${path}`);
        return;
    }
    try {
        const actual = (0, node_crypto_1.createHash)("sha256").update((0, node_fs_1.readFileSync)(absolutePath)).digest("hex");
        if (actual !== expectedHash)
            issue(errors, issuePath, "hash_mismatch", `expected ${expectedHash}, received ${actual}`);
    }
    catch (error) {
        issue(errors, issuePath, "referenced_file_unreadable", error instanceof Error ? error.message : String(error));
    }
}
function asRecord(value, path, errors) {
    if (!isRecord(value)) {
        issue(errors, path, "type", "expected an object");
        return undefined;
    }
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function arrayValue(value, path, errors) {
    if (!Array.isArray(value)) {
        issue(errors, path, "type", "expected an array");
        return [];
    }
    return value;
}
function stringArray(value, path, errors, unique) {
    const values = arrayValue(value, path, errors);
    const strings = [];
    for (let index = 0; index < values.length; index += 1) {
        const item = expectPattern(values[index], ID_PATTERN, `${path}[${index}]`, errors);
        if (item)
            strings.push(item);
    }
    if (unique && new Set(strings).size !== strings.length)
        issue(errors, path, "unique", "expected unique values");
    return strings;
}
function expectLiteral(value, expected, path, errors) {
    if (value !== expected) {
        issue(errors, path, "const", `expected ${String(expected)}`);
        return undefined;
    }
    return expected;
}
function expectPattern(value, pattern, path, errors) {
    if (typeof value !== "string" || !pattern.test(value)) {
        issue(errors, path, "pattern", `expected string matching ${pattern.source}`);
        return undefined;
    }
    return value;
}
function expectNonEmptyString(value, path, errors) {
    if (typeof value !== "string" || value.length === 0) {
        issue(errors, path, "type", "expected a non-empty string");
        return undefined;
    }
    return value;
}
function expectEnum(value, allowed, path, errors) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        issue(errors, path, "enum", `expected one of ${allowed.join(", ")}`);
        return undefined;
    }
    return value;
}
function expectDateTime(value, path, errors) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
        issue(errors, path, "date_time", "expected an ISO-like date-time string");
}
function expectUri(value, path, errors) {
    if (typeof value !== "string") {
        issue(errors, path, "uri", "expected a URI string");
        return;
    }
    try {
        new URL(value);
    }
    catch {
        issue(errors, path, "uri", "expected a valid URI");
    }
}
function expectNonNegativeInteger(value, path, errors) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
        issue(errors, path, "type", "expected a non-negative integer");
}
function safeRelativePath(value) {
    if (typeof value !== "string" || value.length === 0 || (0, node_path_1.isAbsolute)(value) || /^[A-Za-z]:/.test(value))
        return false;
    return !value.split(/[\\/]/).includes("..");
}
function issue(target, path, code, message) {
    target.push({ path, code, message });
}
