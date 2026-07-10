export declare const SOLO_SKILL_NAME = "solo-founder-nodes";
export declare const SOLO_CANONICAL_SKILL_PATH = ".agents/skills/solo-founder-nodes";
export declare const SOLO_CLAUDE_WRAPPER_PATH = ".claude/skills/solo-founder-nodes/SKILL.md";
export declare const SOLO_SETUP_RECEIPT_PATH = ".proofloop/setup/solo-founder.json";
export declare const SOLO_STOP_GATE_PATH = ".proofloop/hooks/solo-stop-gate.cjs";
export declare const SOLO_STOP_GATE_COMMAND = "node .proofloop/hooks/solo-stop-gate.cjs";
/** Stable JSON contract digest, independent of whitespace and line endings. */
export declare const SOLO_SETUP_INTEROP_SCHEMA_DIGEST = "15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9";
/** Raw bytes of the checked-in NodeProof schema, useful only as a local diagnostic. */
export declare const SOLO_SETUP_INTEROP_SCHEMA_RAW_SHA256 = "92f6f24a56f6e31e5d521f09b625d8714370ffa68ea094d340710c715fc901f2";
export declare const SOLO_SFN_PACKAGE_SCRIPT = "npm --prefix .agents/skills/solo-founder-nodes/templates run sfn --";
export declare const SOLO_SMOKE_PACKAGE_SCRIPT = "npm --prefix .agents/skills/solo-founder-nodes/templates run smoke";
export declare const SOLO_CONFORMANCE_PACKAGE_SCRIPT = "node .agents/skills/solo-founder-nodes/conformance/conformance.mjs --run-smoke";
export declare const SOLO_INSTALL_DEPENDENCIES_COMMAND = "npm --prefix .agents/skills/solo-founder-nodes/templates install --ignore-scripts --no-audit --no-fund";
export type SoloSetupAgents = "codex" | "claude-code" | "both";
export type SoloSetupAgent = SoloSetupAgents;
export type SoloSetupStatus = "ready" | "needs_source" | "conflict" | "failed";
export type SoloInstallAction = "none" | "installed" | "unchanged" | "updated";
export type SoloSetupCommandRunnerResult = number | void | {
    status?: number | null;
    exitCode?: number | null;
    error?: unknown;
};
export type SoloSetupCommandRunner = (command: string, args: readonly string[], options: {
    cwd: string;
}) => SoloSetupCommandRunnerResult;
export type SoloSetupOptions = {
    /** Target project root. `root` is accepted as a compatibility alias. */
    targetRoot?: string;
    root?: string;
    /** Either the Solo repository root or its skills/solo-founder-nodes directory. */
    sourceDir?: string;
    agents?: SoloSetupAgents;
    /** Singular compatibility alias for callers that expose `--agent`. */
    agent?: SoloSetupAgents;
    force?: boolean;
    installDependencies?: boolean;
    verify?: boolean;
    commandRunner?: SoloSetupCommandRunner;
    /** Compatibility alias for commandRunner. */
    runCommand?: SoloSetupCommandRunner;
    generatedAt?: string;
    now?: () => Date;
};
export type SoloSetupCommandResult = {
    id: "install-dependencies" | "smoke" | "conformance";
    command: string;
    cwd: string;
    exitCode: number | null;
    status: "passed" | "failed";
    error?: "command could not start" | "command runner threw";
};
export type SoloSetupReceipt = {
    schema: "nodeproof-solo-setup-v1";
    generatedAt: string;
    status: SoloSetupStatus;
    agents: SoloSetupAgents;
    sourcePath: string | null;
    sourceSkillPath: string | null;
    sourceManifestDigest: string | null;
    schemaDigest: typeof SOLO_SETUP_INTEROP_SCHEMA_DIGEST;
    schemaRawSha256: string | null;
    schemaSource: "source" | "nodeproof" | null;
    installAction: SoloInstallAction;
    installedPaths: string[];
    modifiedPaths: string[];
    commandResults: SoloSetupCommandResult[];
    stopCommand: typeof SOLO_STOP_GATE_COMMAND;
    nextCommands: string[];
    message: string;
};
export type SoloSetupResult = SoloSetupReceipt & {
    targetRoot: string;
    skillPath: string;
    claudeWrapperPath: string | null;
    stopGatePath: string;
    receiptPath: string;
    /** Alias intended for direct hook configuration. */
    command: typeof SOLO_STOP_GATE_COMMAND;
};
/** Install a validated local Solo skill without contacting a model provider. */
export declare function setupSolo(options?: SoloSetupOptions): SoloSetupResult;
/** Compatibility aliases for callers that describe setup as installation. */
export declare const installSoloSkill: typeof setupSolo;
export declare const installSoloFounderNodes: typeof setupSolo;
export declare const setupSoloSkill: typeof setupSolo;
export declare const installSoloFounderSkill: typeof setupSolo;
export declare function soloSetupReceiptPath(root: string): string;
/**
 * One host-neutral Stop command: base NodeProof gate, optional Solo judge, then
 * optional NodeProof interop ingestion and gate. It installs no host settings.
 */
export declare function buildSoloStopGateScript(): string;
