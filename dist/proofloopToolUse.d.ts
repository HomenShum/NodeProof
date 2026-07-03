/** Repo-relative path the PostToolUse logger appends to (forward slashes). */
export declare const TOOL_USE_LOG_RELATIVE_PATH = ".proofloop/tooluse/log.jsonl";
export declare const TOOL_USE_CONTRACT_VERSION = 1;
export declare const DEFAULT_MAX_MALFORMED_RATIO = 0.1;
/** Contract file is unusable (missing, unparseable, invalid). CLI exit 2. */
export declare class ToolUseContractError extends Error {
}
/** Trace file is unusable (missing / unreadable). CLI exit 2. */
export declare class ToolUseTraceError extends Error {
}
/** A tool reference: exact name or { pattern } (regex, implicitly anchored). */
export type CompiledToolRef = {
    label: string;
    matches: (name: string) => boolean;
};
export type ToolUseRequiredRule = {
    label: string;
    tool: CompiledToolRef;
    /** MCP server pin: only `mcp__<server>__*` calls from THIS server can satisfy the rule. */
    server?: string;
    minCalls: number;
    maxCalls?: number;
    /** Deep SUBSET matcher; leaves are exact JSON values or { pattern }. */
    params?: Record<string, unknown>;
    note?: string;
};
export type ToolUseForbiddenRule = {
    label: string;
    tool: CompiledToolRef;
    server?: string;
    reason: string;
};
export type ToolUseOrderRule = {
    before: CompiledToolRef;
    after: CompiledToolRef;
};
export type ToolUseContract = {
    version: 1;
    required: ToolUseRequiredRule[];
    forbidden: ToolUseForbiddenRule[];
    order: ToolUseOrderRule[];
    /** Optional default session filter (CLI --session overrides). */
    session?: string;
    maxMalformedRatio: number;
};
export type ToolUseCall = {
    /** 0-based index among the VALID records, in file order. */
    index: number;
    ts?: string;
    sessionId?: string;
    /** Full tool name as logged, e.g. "mcp__composio__GMAIL_SEND_EMAIL" or "Read". */
    tool: string;
    /** MCP server namespace ("composio") or null for non-MCP names. */
    server: string | null;
    /** Bare tool name with the mcp__<server>__ prefix stripped (= tool for non-MCP). */
    bareTool: string;
    params: unknown;
    source?: string;
};
export type ParsedToolUseTrace = {
    calls: ToolUseCall[];
    /** Non-empty lines seen (valid + malformed). */
    totalLines: number;
    malformedLines: number;
};
export type ToolUseViolationKind = "missing_required" | "too_many_calls" | "forbidden_called" | "param_mismatch" | "order_violation" | "malformed_trace" | "empty_trace";
export type ToolUseViolation = {
    kind: ToolUseViolationKind;
    tool: string;
    detail: string;
};
export type ToolUseVerdict = {
    pass: boolean;
    /** Deterministic order: required rules (contract order), forbidden rules, order rules, malformed_trace. */
    violations: ToolUseViolation[];
    stats: {
        calls: number;
        matchedRequired: number;
        malformedLines: number;
    };
};
export declare function splitMcpToolName(name: string): {
    server: string | null;
    bareTool: string;
};
export declare function parseToolUseContract(value: unknown): ToolUseContract;
/** FAIL-CLOSED loader: missing or unparseable contract file throws (never "pass"). */
export declare function loadToolUseContract(path: string): ToolUseContract;
export declare function parseToolUseTrace(text: string): ParsedToolUseTrace;
/** FAIL-CLOSED loader: a missing trace file throws (never "pass"). */
export declare function loadToolUseTrace(path: string): ParsedToolUseTrace;
/**
 * Deep SUBSET match: every key in `matcher` must exist in `actual` and match.
 * Extra keys in `actual` are fine. Leaves:
 *   - {"pattern": "<regex>"}  -> anchored regex against String(primitive value)
 *   - arrays                  -> same length, element-wise match
 *   - objects                 -> recurse (subset)
 *   - primitives/null         -> strict equality
 * Returns null on match, or a human-readable mismatch detail.
 */
export declare function matchParamsSubset(matcher: unknown, actual: unknown, path?: string): string | null;
export declare function verifyToolUseContract(contract: ToolUseContract, trace: ParsedToolUseTrace, options?: {
    session?: string;
}): ToolUseVerdict;
export declare function formatToolUseVerdict(verdict: ToolUseVerdict, context: {
    contractPath: string;
    tracePath: string;
    session?: string;
    requiredRules: number;
}): string;
export declare const TOOL_USE_CONTRACT_TEMPLATES: Record<string, () => Record<string, unknown>>;
export type ToolUseCliIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
/** Exit code contract: 0 = pass, 1 = fail, 2 = contract or trace unusable. */
export declare function runToolUseVerify(options: {
    root: string;
    contractPath: string;
    tracePath?: string;
    session?: string;
    json?: boolean;
} & ToolUseCliIo): 0 | 1 | 2;
export declare function runToolUseInit(options: {
    root: string;
    template?: string;
    outPath?: string;
} & ToolUseCliIo): 0 | 1;
