export declare const PROOFLOOP_RECEIPT_SCHEMA: "proofloop.receipt/v1";
export declare const PROOFLOOP_RECEIPT_SCHEMA_VERSION: 1;
export declare const PROOFLOOP_RECEIPT_SCHEMA_FILE: "proofloop-receipt-v1.schema.json";
export type ProofReceiptAuthority = "authoritative" | "advisory" | "informational";
export type ProofReceiptStatus = "passed" | "failed" | "blocked" | "incomplete" | "error" | "unknown";
export type ProofReceiptDecisionMethod = "deterministic_gate" | "official_scorer" | "model_judge" | "human_review" | "external_claim" | "none";
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
export declare function proofReceiptSchemaPath(): string;
export declare function readProofReceiptSchema(): unknown;
export declare function canonicalJson(value: unknown): string;
export declare function sha256Utf8(value: string): string;
export declare function sha256CanonicalJson(value: unknown): string;
export declare function createInlineProofReceiptPayload(schema: string, data: unknown, version?: string | number): ProofReceiptPayload;
export declare function createInlineProofReceiptResource(options: {
    id: string;
    kind: string;
    inline: unknown;
    description?: string;
    mediaType?: string;
    visibility?: "private" | "team" | "public";
    redacted?: boolean;
}): ProofReceiptResource;
export declare function validateProofReceiptEnvelope(value: unknown): ProofReceiptValidation;
export declare function verifyProofReceiptEnvelopeFile(options: {
    root: string;
    filePath: string;
}): ProofReceiptFileVerification;
export declare function formatProofReceiptVerification(result: ProofReceiptFileVerification): string;
export declare function runProofReceiptEnvelopeVerify(options: {
    root: string;
    filePath: string;
    json?: boolean;
    log?: (message: string) => void;
    logError?: (message: string) => void;
}): number;
