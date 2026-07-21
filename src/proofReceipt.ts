import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const PROOFLOOP_RECEIPT_SCHEMA = "proofloop.receipt/v1" as const;
export const PROOFLOOP_RECEIPT_SCHEMA_VERSION = 1 as const;
export const PROOFLOOP_RECEIPT_SCHEMA_FILE = "proofloop-receipt-v1.schema.json" as const;

export type ProofReceiptAuthority = "authoritative" | "advisory" | "informational";
export type ProofReceiptStatus = "passed" | "failed" | "blocked" | "incomplete" | "error" | "unknown";
export type ProofReceiptDecisionMethod =
  | "deterministic_gate"
  | "official_scorer"
  | "model_judge"
  | "human_review"
  | "external_claim"
  | "none";
export type ProofReceiptCheckStatus = "passed" | "failed" | "blocked" | "error" | "skipped" | "unknown";
export type ProofReceiptCheckMethod = "deterministic" | "official_scorer" | "model_judge" | "human_review" | "external";
export type ProofReceiptHashMethod = "raw-bytes-sha256" | "canonical-json-sha256" | "utf8-sha256";

export interface ProofReceiptResource {
  id: string;
  kind: string;
  description?: string;
  path?: string;
  uri?: string;
  inline?: unknown;
  sha256: string;
  hashMethod: ProofReceiptHashMethod;
  mediaType?: string;
  visibility?: "private" | "team" | "public";
  redacted?: boolean;
}

export interface ProofReceiptCheck {
  id: string;
  status: ProofReceiptCheckStatus;
  role: "decisive" | "advisory";
  method: ProofReceiptCheckMethod;
  summary: string;
  evidenceRefs: string[];
  durationMs?: number;
  exitCode?: number;
  score?: number;
  threshold?: number;
  scorer?: {
    name: string;
    version: string;
    digest?: string;
  };
}

export interface ProofReceiptPayload {
  schema: string;
  version?: string | number;
  mode: "inline" | "reference";
  data?: unknown;
  ref?: string;
  sha256: string;
  hashMethod: "raw-bytes-sha256" | "canonical-json-sha256";
}

export interface ProofReceiptEnvelope {
  $schema?: string;
  schema: typeof PROOFLOOP_RECEIPT_SCHEMA;
  schemaVersion: typeof PROOFLOOP_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  kind: string;
  createdAt: string;
  producer: {
    id: string;
    version: string;
    runtime?: string;
    configHash?: string;
  };
  subject: {
    type: "repository" | "deployment" | "run" | "workflow" | "artifact" | "evaluation" | "application";
    id: string;
    runId?: string;
    artifactId?: string;
    targetUrl?: string;
    repository?: {
      url?: string;
      baseCommit?: string;
      candidateCommit?: string;
      branch?: string;
      dirty?: boolean;
    };
  };
  claim?: {
    text: string;
    boundary: "product_path" | "proxy" | "official" | "internal";
    tier?: "local_ready" | "team_ready" | "certification_ready";
  };
  verdict: {
    status: ProofReceiptStatus;
    authority: ProofReceiptAuthority;
    decisionMethod: ProofReceiptDecisionMethod;
    decisiveCheckIds: string[];
    summary: string;
  };
  checks: ProofReceiptCheck[];
  evidence: ProofReceiptResource[];
  artifacts?: ProofReceiptResource[];
  payload: ProofReceiptPayload;
  lineage?: {
    parentReceiptIds?: string[];
    sourceReceiptIds?: string[];
    migration?: string;
  };
  timing?: {
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    phases?: Array<{
      id: string;
      startedAt?: string;
      completedAt?: string;
      durationMs: number;
    }>;
  };
  budget?: {
    maxUsd?: number;
    spentUsd?: number;
    maxRuntimeMs?: number;
    maxModelCalls?: number;
    modelCalls?: number;
  };
  privacy?: {
    visibility: "private" | "team" | "public";
    redacted: boolean;
    containsPersonalData?: boolean;
    externalEgress?: boolean;
  };
  extensions?: Record<string, unknown>;
}

export interface ProofReceiptIssue {
  path: string;
  code: string;
  message: string;
}

export interface ProofReceiptValidation {
  ok: boolean;
  errors: ProofReceiptIssue[];
  warnings: ProofReceiptIssue[];
  envelope?: ProofReceiptEnvelope;
}

export interface ProofReceiptFileVerification extends ProofReceiptValidation {
  receiptPath: string;
}

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const KIND_PATTERN = /^[a-z][a-z0-9._/-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const AUTHORITATIVE_METHODS = new Set<ProofReceiptDecisionMethod>(["deterministic_gate", "official_scorer"]);
const DECISIVE_CHECK_METHODS = new Set<ProofReceiptCheckMethod>(["deterministic", "official_scorer"]);
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

export function proofReceiptSchemaPath(): string {
  return resolve(__dirname, "..", "schemas", PROOFLOOP_RECEIPT_SCHEMA_FILE);
}

export function readProofReceiptSchema(): unknown {
  return JSON.parse(readFileSync(proofReceiptSchemaPath(), "utf8"));
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256Utf8(canonicalJson(value));
}

export function createInlineProofReceiptPayload(
  schema: string,
  data: unknown,
  version?: string | number,
): ProofReceiptPayload {
  return {
    schema,
    ...(version !== undefined ? { version } : {}),
    mode: "inline",
    data,
    sha256: sha256CanonicalJson(data),
    hashMethod: "canonical-json-sha256",
  };
}

export function createInlineProofReceiptResource(options: {
  id: string;
  kind: string;
  inline: unknown;
  description?: string;
  mediaType?: string;
  visibility?: "private" | "team" | "public";
  redacted?: boolean;
}): ProofReceiptResource {
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

export function validateProofReceiptEnvelope(value: unknown): ProofReceiptValidation {
  const errors: ProofReceiptIssue[] = [];
  const warnings: ProofReceiptIssue[] = [];
  const receipt = asRecord(value, "$", errors);
  if (!receipt) return { ok: false, errors, warnings };

  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_KEYS.has(key)) issue(errors, `$.${key}`, "unknown_property", "unknown top-level property");
  }

  expectLiteral(receipt.schema, PROOFLOOP_RECEIPT_SCHEMA, "$.schema", errors);
  expectLiteral(receipt.schemaVersion, PROOFLOOP_RECEIPT_SCHEMA_VERSION, "$.schemaVersion", errors);
  expectPattern(receipt.receiptId, ID_PATTERN, "$.receiptId", errors);
  expectPattern(receipt.kind, KIND_PATTERN, "$.kind", errors);
  expectDateTime(receipt.createdAt, "$.createdAt", errors);

  const producer = asRecord(receipt.producer, "$.producer", errors);
  if (producer) {
    expectPattern(producer.id, ID_PATTERN, "$.producer.id", errors);
    expectNonEmptyString(producer.version, "$.producer.version", errors);
    if (producer.configHash !== undefined) expectPattern(producer.configHash, SHA256_PATTERN, "$.producer.configHash", errors);
  }

  const subject = asRecord(receipt.subject, "$.subject", errors);
  if (subject) {
    expectEnum(subject.type, ["repository", "deployment", "run", "workflow", "artifact", "evaluation", "application"], "$.subject.type", errors);
    expectPattern(subject.id, ID_PATTERN, "$.subject.id", errors);
    if (subject.runId !== undefined) expectPattern(subject.runId, ID_PATTERN, "$.subject.runId", errors);
    if (subject.artifactId !== undefined) expectPattern(subject.artifactId, ID_PATTERN, "$.subject.artifactId", errors);
    if (subject.targetUrl !== undefined) expectUri(subject.targetUrl, "$.subject.targetUrl", errors);
    const repository = subject.repository === undefined ? undefined : asRecord(subject.repository, "$.subject.repository", errors);
    if (repository) {
      if (repository.baseCommit !== undefined) expectPattern(repository.baseCommit, GIT_SHA_PATTERN, "$.subject.repository.baseCommit", errors);
      if (repository.candidateCommit !== undefined) expectPattern(repository.candidateCommit, GIT_SHA_PATTERN, "$.subject.repository.candidateCommit", errors);
    }
  }

  const verdict = asRecord(receipt.verdict, "$.verdict", errors);
  const status = verdict ? expectEnum<ProofReceiptStatus>(verdict.status, ["passed", "failed", "blocked", "incomplete", "error", "unknown"], "$.verdict.status", errors) : undefined;
  const authority = verdict ? expectEnum<ProofReceiptAuthority>(verdict.authority, ["authoritative", "advisory", "informational"], "$.verdict.authority", errors) : undefined;
  const decisionMethod = verdict ? expectEnum<ProofReceiptDecisionMethod>(verdict.decisionMethod, ["deterministic_gate", "official_scorer", "model_judge", "human_review", "external_claim", "none"], "$.verdict.decisionMethod", errors) : undefined;
  if (verdict) expectNonEmptyString(verdict.summary, "$.verdict.summary", errors);
  const decisiveCheckIds = verdict ? stringArray(verdict.decisiveCheckIds, "$.verdict.decisiveCheckIds", errors, true) : [];

  const checkValues = arrayValue(receipt.checks, "$.checks", errors);
  const checks: ProofReceiptCheck[] = [];
  const checkIds = new Set<string>();
  for (let index = 0; index < checkValues.length; index += 1) {
    const check = validateCheck(checkValues[index], index, errors);
    if (!check) continue;
    if (checkIds.has(check.id)) issue(errors, `$.checks[${index}].id`, "duplicate_id", `duplicate check id ${check.id}`);
    checkIds.add(check.id);
    checks.push(check);
  }

  const evidenceValues = arrayValue(receipt.evidence, "$.evidence", errors);
  const evidence: ProofReceiptResource[] = [];
  const evidenceIds = new Set<string>();
  for (let index = 0; index < evidenceValues.length; index += 1) {
    const resource = validateResource(evidenceValues[index], `$.evidence[${index}]`, errors);
    if (!resource) continue;
    if (evidenceIds.has(resource.id)) issue(errors, `$.evidence[${index}].id`, "duplicate_id", `duplicate evidence id ${resource.id}`);
    evidenceIds.add(resource.id);
    evidence.push(resource);
  }

  const artifactValues = receipt.artifacts === undefined ? [] : arrayValue(receipt.artifacts, "$.artifacts", errors);
  const artifacts: ProofReceiptResource[] = [];
  const artifactIds = new Set<string>();
  for (let index = 0; index < artifactValues.length; index += 1) {
    const resource = validateResource(artifactValues[index], `$.artifacts[${index}]`, errors);
    if (!resource) continue;
    if (artifactIds.has(resource.id)) issue(errors, `$.artifacts[${index}].id`, "duplicate_id", `duplicate artifact id ${resource.id}`);
    artifactIds.add(resource.id);
    artifacts.push(resource);
  }

  for (const check of checks) {
    for (const evidenceRef of check.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) issue(errors, `$.checks.${check.id}.evidenceRefs`, "missing_evidence", `unknown evidence ref ${evidenceRef}`);
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
    if (decisiveCheckIds.length === 0) issue(errors, "$.verdict.decisiveCheckIds", "missing_decisive_check", "authoritative verdicts require at least one decisive check");

    const decisiveIds = new Set(decisiveCheckIds);
    const decisiveChecks = checks.filter((check) => decisiveIds.has(check.id));
    for (const id of decisiveCheckIds) {
      if (!checkIds.has(id)) issue(errors, "$.verdict.decisiveCheckIds", "missing_check", `unknown decisive check ${id}`);
    }
    for (const check of checks.filter((entry) => entry.role === "decisive")) {
      if (!decisiveIds.has(check.id)) issue(errors, `$.checks.${check.id}.role`, "unlisted_decisive_check", "decisive checks must be listed in verdict.decisiveCheckIds");
    }
    for (const check of decisiveChecks) {
      if (check.role !== "decisive") issue(errors, `$.checks.${check.id}.role`, "authority_violation", "a decisiveCheckId must reference a decisive check");
      if (!DECISIVE_CHECK_METHODS.has(check.method)) issue(errors, `$.checks.${check.id}.method`, "authority_violation", "model, human, and external checks cannot decide an authoritative verdict");
      if (check.evidenceRefs.length === 0) issue(errors, `$.checks.${check.id}.evidenceRefs`, "missing_evidence", "decisive checks require locally verifiable evidence");
      for (const ref of check.evidenceRefs) {
        const resource = evidence.find((entry) => entry.id === ref);
        if (resource?.uri !== undefined) issue(errors, `$.evidence.${ref}.uri`, "unverifiable_decisive_evidence", "URI-only evidence cannot decide an authoritative local verification");
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
  } else if (authority !== undefined) {
    if (decisiveCheckIds.length > 0) issue(errors, "$.verdict.decisiveCheckIds", "authority_violation", "non-authoritative receipts cannot declare decisive checks");
    for (const check of checks) {
      if (check.role === "decisive") issue(errors, `$.checks.${check.id}.role`, "authority_violation", "non-authoritative receipts may contain advisory checks only");
    }
  }

  if (authority === "informational") {
    if (status !== "incomplete" && status !== "unknown") issue(errors, "$.verdict.status", "informational_verdict", "informational receipts must be incomplete or unknown");
    if (decisionMethod !== "none") issue(errors, "$.verdict.decisionMethod", "informational_verdict", "informational receipts use decisionMethod none");
  }

  const envelope = errors.length === 0 ? value as ProofReceiptEnvelope : undefined;
  return { ok: errors.length === 0, errors, warnings, ...(envelope ? { envelope } : {}) };
}

export function verifyProofReceiptEnvelopeFile(options: { root: string; filePath: string }): ProofReceiptFileVerification {
  const receiptPath = isAbsolute(options.filePath) ? options.filePath : resolve(options.root, options.filePath);
  if (!existsSync(receiptPath)) {
    return {
      ok: false,
      receiptPath,
      errors: [{ path: "$", code: "receipt_missing", message: "receipt file does not exist" }],
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
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
    const baseDir = dirname(receiptPath);
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

export function formatProofReceiptVerification(result: ProofReceiptFileVerification): string {
  const lines = [
    `schema=${PROOFLOOP_RECEIPT_SCHEMA}`,
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
  if (result.errors.length === 0) lines.push("- PASS envelope and local integrity checks");
  for (const error of result.errors) lines.push(`- FAIL ${error.path} ${error.code}: ${error.message}`);
  for (const warning of result.warnings) lines.push(`- WARN ${warning.path} ${warning.code}: ${warning.message}`);
  return `${lines.join("\n")}\n`;
}

export function runProofReceiptEnvelopeVerify(options: {
  root: string;
  filePath: string;
  json?: boolean;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): number {
  const result = verifyProofReceiptEnvelopeFile(options);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const output = options.json === true ? JSON.stringify(result, null, 2) : formatProofReceiptVerification(result);
  if (result.ok) log(output);
  else logError(output);
  return result.ok ? 0 : 1;
}

function validateCheck(value: unknown, index: number, errors: ProofReceiptIssue[]): ProofReceiptCheck | undefined {
  const path = `$.checks[${index}]`;
  const check = asRecord(value, path, errors);
  if (!check) return undefined;
  const id = expectPattern(check.id, ID_PATTERN, `${path}.id`, errors);
  const status = expectEnum<ProofReceiptCheckStatus>(check.status, ["passed", "failed", "blocked", "error", "skipped", "unknown"], `${path}.status`, errors);
  const role = expectEnum<"decisive" | "advisory">(check.role, ["decisive", "advisory"], `${path}.role`, errors);
  const method = expectEnum<ProofReceiptCheckMethod>(check.method, ["deterministic", "official_scorer", "model_judge", "human_review", "external"], `${path}.method`, errors);
  const summary = expectNonEmptyString(check.summary, `${path}.summary`, errors);
  const evidenceRefs = stringArray(check.evidenceRefs, `${path}.evidenceRefs`, errors, true);
  if (check.durationMs !== undefined) expectNonNegativeInteger(check.durationMs, `${path}.durationMs`, errors);
  if (check.exitCode !== undefined && !Number.isInteger(check.exitCode)) issue(errors, `${path}.exitCode`, "type", "expected an integer");
  if (check.score !== undefined && (typeof check.score !== "number" || !Number.isFinite(check.score))) issue(errors, `${path}.score`, "type", "expected a finite number");
  if (check.threshold !== undefined && (typeof check.threshold !== "number" || !Number.isFinite(check.threshold))) issue(errors, `${path}.threshold`, "type", "expected a finite number");
  const scorer = check.scorer === undefined ? undefined : asRecord(check.scorer, `${path}.scorer`, errors);
  if (scorer) {
    expectNonEmptyString(scorer.name, `${path}.scorer.name`, errors);
    expectNonEmptyString(scorer.version, `${path}.scorer.version`, errors);
    if (scorer.digest !== undefined) expectPattern(scorer.digest, SHA256_PATTERN, `${path}.scorer.digest`, errors);
  }
  if (role === "decisive" && method && !DECISIVE_CHECK_METHODS.has(method)) issue(errors, `${path}.method`, "authority_violation", "decisive checks must be deterministic or official scorers");
  if (role === "decisive" && evidenceRefs.length === 0) issue(errors, `${path}.evidenceRefs`, "missing_evidence", "decisive checks require evidence");
  if (method === "official_scorer") {
    if (!scorer) issue(errors, `${path}.scorer`, "missing_scorer", "official scorer checks require scorer identity");
    else if (scorer.digest === undefined) issue(errors, `${path}.scorer.digest`, "missing_scorer_digest", "official scorer checks require an immutable scorer digest");
  }
  if (!id || !status || !role || !method || !summary) return undefined;
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
    ...(scorer ? { scorer: check.scorer as ProofReceiptCheck["scorer"] } : {}),
  };
}

function validateResource(value: unknown, path: string, errors: ProofReceiptIssue[]): ProofReceiptResource | undefined {
  const resource = asRecord(value, path, errors);
  if (!resource) return undefined;
  const id = expectPattern(resource.id, ID_PATTERN, `${path}.id`, errors);
  const kind = expectPattern(resource.kind, KIND_PATTERN, `${path}.kind`, errors);
  const sha256 = expectPattern(resource.sha256, SHA256_PATTERN, `${path}.sha256`, errors);
  const hashMethod = expectEnum<ProofReceiptHashMethod>(resource.hashMethod, ["raw-bytes-sha256", "canonical-json-sha256", "utf8-sha256"], `${path}.hashMethod`, errors);
  const locators = [resource.path !== undefined, resource.uri !== undefined, Object.prototype.hasOwnProperty.call(resource, "inline")].filter(Boolean).length;
  if (locators !== 1) issue(errors, path, "resource_locator", "exactly one of path, uri, or inline is required");
  if (resource.path !== undefined && !safeRelativePath(resource.path)) issue(errors, `${path}.path`, "relative_path", "expected a safe relative path without parent traversal");
  if (resource.uri !== undefined) expectUri(resource.uri, `${path}.uri`, errors);
  if (resource.path !== undefined || resource.uri !== undefined) {
    if (hashMethod && hashMethod !== "raw-bytes-sha256") issue(errors, `${path}.hashMethod`, "hash_method", "path and URI resources use raw-bytes-sha256");
  }
  if (Object.prototype.hasOwnProperty.call(resource, "inline")) {
    if (hashMethod === "canonical-json-sha256") {
      try {
        if (sha256 && sha256CanonicalJson(resource.inline) !== sha256) issue(errors, `${path}.sha256`, "hash_mismatch", "inline canonical JSON hash does not match");
      } catch (error) {
        issue(errors, `${path}.inline`, "canonical_json", error instanceof Error ? error.message : String(error));
      }
    } else if (hashMethod === "utf8-sha256") {
      if (typeof resource.inline !== "string") issue(errors, `${path}.inline`, "type", "utf8-sha256 requires an inline string");
      else if (sha256 && sha256Utf8(resource.inline) !== sha256) issue(errors, `${path}.sha256`, "hash_mismatch", "inline UTF-8 hash does not match");
    } else if (hashMethod !== undefined) {
      issue(errors, `${path}.hashMethod`, "hash_method", "inline resources use canonical-json-sha256 or utf8-sha256");
    }
  }
  if (!id || !kind || !sha256 || !hashMethod) return undefined;
  return value as ProofReceiptResource;
}

function validatePayload(value: unknown, errors: ProofReceiptIssue[]): ProofReceiptPayload | undefined {
  const payload = asRecord(value, "$.payload", errors);
  if (!payload) return undefined;
  const schema = expectNonEmptyString(payload.schema, "$.payload.schema", errors);
  const mode = expectEnum<"inline" | "reference">(payload.mode, ["inline", "reference"], "$.payload.mode", errors);
  const sha256 = expectPattern(payload.sha256, SHA256_PATTERN, "$.payload.sha256", errors);
  const hashMethod = expectEnum<"raw-bytes-sha256" | "canonical-json-sha256">(payload.hashMethod, ["raw-bytes-sha256", "canonical-json-sha256"], "$.payload.hashMethod", errors);
  const hasData = Object.prototype.hasOwnProperty.call(payload, "data");
  const hasRef = payload.ref !== undefined;
  if (mode === "inline") {
    if (!hasData || hasRef) issue(errors, "$.payload", "payload_mode", "inline payload requires data and forbids ref");
    if (hashMethod !== "canonical-json-sha256") issue(errors, "$.payload.hashMethod", "hash_method", "inline payloads use canonical-json-sha256");
    if (hasData && sha256) {
      try {
        if (sha256CanonicalJson(payload.data) !== sha256) issue(errors, "$.payload.sha256", "hash_mismatch", "inline payload canonical JSON hash does not match");
      } catch (error) {
        issue(errors, "$.payload.data", "canonical_json", error instanceof Error ? error.message : String(error));
      }
    }
  } else if (mode === "reference") {
    if (!hasRef || hasData) issue(errors, "$.payload", "payload_mode", "reference payload requires ref and forbids data");
    if (!safeRelativePath(payload.ref)) issue(errors, "$.payload.ref", "relative_path", "expected a safe relative path without parent traversal");
    if (hashMethod !== "raw-bytes-sha256") issue(errors, "$.payload.hashMethod", "hash_method", "reference payloads use raw-bytes-sha256");
  }
  if (!schema || !mode || !sha256 || !hashMethod) return undefined;
  return value as ProofReceiptPayload;
}

function verifyPayloadIntegrity(payload: ProofReceiptPayload, baseDir: string, errors: ProofReceiptIssue[]): void {
  if (payload.mode === "inline") return;
  if (!payload.ref || !safeRelativePath(payload.ref)) return;
  verifyRelativeFileHash(payload.ref, payload.sha256, baseDir, "$.payload.ref", errors);
}

function verifyResourceIntegrity(resource: ProofReceiptResource, baseDir: string, errors: ProofReceiptIssue[]): void {
  if (!resource.path || !safeRelativePath(resource.path)) return;
  verifyRelativeFileHash(resource.path, resource.sha256, baseDir, `$.resources.${resource.id}.path`, errors);
}

function verifyRelativeFileHash(path: string, expectedHash: string, baseDir: string, issuePath: string, errors: ProofReceiptIssue[]): void {
  const absolutePath = resolve(baseDir, path);
  const escaped = relative(baseDir, absolutePath);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    issue(errors, issuePath, "path_escape", "referenced file escapes the receipt directory");
    return;
  }
  if (!existsSync(absolutePath)) {
    issue(errors, issuePath, "referenced_file_missing", `referenced file does not exist: ${path}`);
    return;
  }
  try {
    const actual = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
    if (actual !== expectedHash) issue(errors, issuePath, "hash_mismatch", `expected ${expectedHash}, received ${actual}`);
  } catch (error) {
    issue(errors, issuePath, "referenced_file_unreadable", error instanceof Error ? error.message : String(error));
  }
}

function asRecord(value: unknown, path: string, errors: ProofReceiptIssue[]): UnknownRecord | undefined {
  if (!isRecord(value)) {
    issue(errors, path, "type", "expected an object");
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown, path: string, errors: ProofReceiptIssue[]): unknown[] {
  if (!Array.isArray(value)) {
    issue(errors, path, "type", "expected an array");
    return [];
  }
  return value;
}

function stringArray(value: unknown, path: string, errors: ProofReceiptIssue[], unique: boolean): string[] {
  const values = arrayValue(value, path, errors);
  const strings: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = expectPattern(values[index], ID_PATTERN, `${path}[${index}]`, errors);
    if (item) strings.push(item);
  }
  if (unique && new Set(strings).size !== strings.length) issue(errors, path, "unique", "expected unique values");
  return strings;
}

function expectLiteral<T extends string | number>(value: unknown, expected: T, path: string, errors: ProofReceiptIssue[]): T | undefined {
  if (value !== expected) {
    issue(errors, path, "const", `expected ${String(expected)}`);
    return undefined;
  }
  return expected;
}

function expectPattern(value: unknown, pattern: RegExp, path: string, errors: ProofReceiptIssue[]): string | undefined {
  if (typeof value !== "string" || !pattern.test(value)) {
    issue(errors, path, "pattern", `expected string matching ${pattern.source}`);
    return undefined;
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string, errors: ProofReceiptIssue[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    issue(errors, path, "type", "expected a non-empty string");
    return undefined;
  }
  return value;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], path: string, errors: ProofReceiptIssue[]): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issue(errors, path, "enum", `expected one of ${allowed.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function expectDateTime(value: unknown, path: string, errors: ProofReceiptIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) issue(errors, path, "date_time", "expected an ISO-like date-time string");
}

function expectUri(value: unknown, path: string, errors: ProofReceiptIssue[]): void {
  if (typeof value !== "string") {
    issue(errors, path, "uri", "expected a URI string");
    return;
  }
  try {
    new URL(value);
  } catch {
    issue(errors, path, "uri", "expected a valid URI");
  }
}

function expectNonNegativeInteger(value: unknown, path: string, errors: ProofReceiptIssue[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) issue(errors, path, "type", "expected a non-negative integer");
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

function issue(target: ProofReceiptIssue[], path: string, code: string, message: string): void {
  target.push({ path, code, message });
}
