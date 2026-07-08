export declare const PROOFLOOP_HOOK_COMMAND_PREFIX = "node .proofloop/hooks/";
export declare const STOP_GATE_COMMAND = "node .proofloop/hooks/stop-gate.mjs";
export declare const PRETOOLUSE_GUARD_COMMAND = "node .proofloop/hooks/pretooluse-guard.mjs";
export declare const POSTTOOLUSE_LOG_COMMAND = "node .proofloop/hooks/posttooluse-log.mjs";
export declare const PRETOOLUSE_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
/**
 * Matcher for the PostToolUse logger: ALL tools. Claude Code treats matchers
 * as regexes; ".*" matches every tool name regardless of anchoring, so MCP
 * names like mcp__composio__GMAIL_SEND_EMAIL are captured too.
 */
export declare const POSTTOOLUSE_LOG_MATCHER = ".*";
export declare const DEFAULT_MAX_STOP_BLOCKS = 5;
/**
 * OPTIONAL command-mode gate for the Stop hook. NOT the default: the default
 * is "check-only" (read the persisted .proofloop/gate-state.json verdict
 * directly, in-process). A Stop hook must be deterministic and offline-safe;
 * `npx proofloop ...` inside the hook would make the stop verdict depend on
 * npm/registry/network state (and 404s outright until the package is
 * published). Users who want a live re-run on every stop attempt can opt in
 * with `--gate-command "npx proofloop gate"` (or any command).
 */
export declare const DEFAULT_GATE_COMMAND = "npx proofloop gate --check";
/** Path prefixes whose NEW CONTENT is scanned for verifier-weakening patterns. */
export declare const GUARDED_CONTENT_PATH_PREFIXES: readonly string[];
export type ProofloopHooksConfig = {
    schema: "proofloop-hooks-v1";
    worker: ProofloopHookWorker;
    generatedAt: string;
    /**
     * "check-only" (package default): read .proofloop/gate-state.json directly
     * (no side effects, no subprocess, no network) and require
     * status === "passed".
     * "command": spawn `gateCommand` and use its exit code (0 = pass). Only
     * used when an explicit gate command was provided at install time.
     */
    gateMode: "check-only" | "command";
    gateCommand: string | null;
    /** Repo-relative path the "check-only" mode reads. */
    gateStatePath: string;
    maxStopBlocks: number;
    /**
     * Whether the PostToolUse logger (expected-tool-use capture) is installed.
     * The capture is LOCAL: it records what this worker session's tool hooks
     * saw, nothing more (no server-side attestation).
     */
    toolUseLog: boolean;
    /** Repo-relative JSONL path the logger appends to. */
    toolUseLogPath: string;
    immutableFiles: string[];
    protectedExtraPaths: string[];
    guardedContentPathPrefixes: string[];
    verifierWeakeningPatterns: {
        source: string;
        flags: string;
    }[];
};
export type ProofloopHooksInstallOptions = {
    root?: string;
    /** Write the host's local settings file instead of the shared settings file. */
    local?: boolean;
    worker?: string;
    /** Override the gate with a real command (switches gateMode to "command"). */
    gateCommand?: string;
    /** Force check-only mode even if a gateCommand was passed. */
    checkOnly?: boolean;
    maxStopBlocks?: number;
    /** false (`--no-tooluse-log`) skips the PostToolUse expected-tool-use logger. Default true. */
    toolUseLog?: boolean;
    now?: () => Date;
};
export type ProofloopHookWorker = "claude-code" | "codex";
export type ProofloopHooksInstallResult = {
    root: string;
    settingsPath: string;
    hooksDir: string;
    configPath: string;
    stopGatePath: string;
    preToolUseGuardPath: string;
    /** null when installed with toolUseLog: false. */
    postToolUseLogPath: string | null;
    addedStopHook: boolean;
    addedPreToolUseHook: boolean;
    addedPostToolUseLogHook: boolean;
};
export type ProofloopHooksUninstallOptions = {
    root?: string;
    /** Also delete the .proofloop/hooks/ scripts + config + state. */
    purge?: boolean;
};
export type ProofloopHooksUninstallResult = {
    root: string;
    cleanedSettingsPaths: string[];
    removedEntries: number;
    purgedHooksDir: boolean;
};
export type ProofloopHooksStatus = {
    root: string;
    settings: {
        path: string;
        exists: boolean;
        stopHookInstalled: boolean;
        preToolUseHookInstalled: boolean;
        postToolUseLogInstalled: boolean;
    }[];
    scripts: {
        path: string;
        exists: boolean;
    }[];
    configPath: string;
    configExists: boolean;
    maxStopBlocks?: number;
    gateMode?: string;
    gateCommand?: string | null;
    toolUseLog?: boolean;
    toolUseLogPath?: string;
    sessionBlockCounts: Record<string, number>;
};
type JsonRecord = Record<string, unknown>;
export declare function installProofloopHooks(options?: ProofloopHooksInstallOptions): ProofloopHooksInstallResult;
export declare function buildHooksConfig(options?: ProofloopHooksInstallOptions): ProofloopHooksConfig;
/**
 * Deep-merge our hook entries into an existing Claude Code settings object.
 * Never clobbers user hooks: appends to existing arrays, preserves unknown
 * keys, and is idempotent (an entry whose command starts with
 * PROOFLOOP_HOOK_COMMAND_PREFIX is recognized as ours and not duplicated).
 */
export declare function mergeHookEntries(settings: JsonRecord, options?: {
    toolUseLog?: boolean;
}): {
    addedStop: boolean;
    addedPreToolUse: boolean;
    addedPostToolUseLog: boolean;
};
/**
 * Codex hook configuration uses a flat hooks array. The command scripts are
 * the same self-contained Node scripts used by Claude Code: they consume stdin
 * JSON and keep Proof Loop's Stop/PreToolUse/PostToolUse semantics host-neutral.
 */
export declare function mergeCodexHookEntries(settings: JsonRecord, options?: {
    toolUseLog?: boolean;
}): {
    addedStop: boolean;
    addedPreToolUse: boolean;
    addedPostToolUseLog: boolean;
};
export declare function uninstallProofloopHooks(options?: ProofloopHooksUninstallOptions): ProofloopHooksUninstallResult;
/** Remove ONLY entries whose command carries our marker prefix. */
export declare function removeOurHookEntries(settings: JsonRecord): number;
export declare function proofloopHooksStatus(options?: {
    root?: string;
}): ProofloopHooksStatus;
export declare function formatProofloopHooksStatus(status: ProofloopHooksStatus): string;
export {};
