import { type ProofloopHookWorker } from "./proofloopHooks";
export declare const PROOFLOOP_AGENT_ADAPTER_IDS: readonly ["codex", "claude-code", "cursor", "windsurf", "devin", "generic-cli"];
export type ProofloopAgentAdapterId = (typeof PROOFLOOP_AGENT_ADAPTER_IDS)[number];
export type ProofloopAgentAdapterStatus = "ready" | "needs_adapter" | "needs_command" | "failed";
export type HookInstallResult = {
    schema: "proofloop-agent-adapter-setup-v1";
    generatedAt: string;
    adapterId: ProofloopAgentAdapterId;
    status: ProofloopAgentAdapterStatus;
    hookHost?: ProofloopHookWorker;
    settingsPath?: string;
    message: string;
    launchCommand?: string;
    traceCapture: string[];
    gateEnforcement: string[];
    nextCommands: string[];
    receiptPath: string;
};
export type AgentRunResult = {
    adapterId: ProofloopAgentAdapterId;
    status: "launched" | "needs_adapter" | "needs_command" | "failed";
    launched: boolean;
    command?: string;
    promptPath: string;
    exitCode?: number;
    stdoutPath?: string;
    stderrPath?: string;
    message: string;
};
export type AgentTrace = {
    schema: "proofloop-agent-trace-v1";
    adapterId: ProofloopAgentAdapterId;
    runDir: string;
    evidenceFiles: string[];
};
export type ProofloopVerdict = {
    runId: string;
    suite: string;
    cmd: string;
    passed: boolean;
    exitCode: number;
    score?: number;
    minScore?: number;
    failedGates?: string[];
    receiptPaths: string[];
};
export type ProofloopAgentAdapter = {
    id: ProofloopAgentAdapterId;
    installHooks(targetDir: string, options?: {
        local?: boolean;
        command?: string;
    }): Promise<HookInstallResult>;
    launch(promptPath: string, targetDir: string, options?: {
        command?: string;
        env?: NodeJS.ProcessEnv;
    }): Promise<AgentRunResult>;
    collectTrace(runDir: string): Promise<AgentTrace>;
    buildRepairPrompt(verdict: ProofloopVerdict, options?: {
        repairPrompt?: string;
        attempt?: number;
        maxAttempts?: number;
    }): Promise<string>;
};
export declare function parseProofloopAgentAdapterId(value: string): ProofloopAgentAdapterId;
export declare function getProofloopAgentAdapter(id: ProofloopAgentAdapterId): ProofloopAgentAdapter;
export declare function setupProofloopAgentAdapter(args: {
    adapterId: ProofloopAgentAdapterId;
    root?: string;
    local?: boolean;
    command?: string;
    generatedAt?: string;
}): Promise<HookInstallResult>;
export declare function launchProofloopAgentAdapter(args: {
    adapterId: ProofloopAgentAdapterId;
    promptPath: string;
    targetDir?: string;
    command?: string;
    env?: NodeJS.ProcessEnv;
}): AgentRunResult;
export declare function collectProofloopAgentTrace(args: {
    adapterId: ProofloopAgentAdapterId;
    runDir: string;
    root?: string;
}): AgentTrace;
export declare function buildAgentRepairPrompt(args: {
    adapterId: ProofloopAgentAdapterId;
    verdict: ProofloopVerdict;
    repairPrompt?: string;
    attempt?: number;
    maxAttempts?: number;
}): string;
export declare function writeAgentRepairAttemptReceipt(args: {
    root: string;
    runDir: string;
    generatedAt?: string;
    adapterId: ProofloopAgentAdapterId;
    meta: ProofloopVerdict;
    repairPromptPath: string;
    attempt: number;
    maxAttempts: number;
    runResult: AgentRunResult;
}): string;
export declare function agentSetupReceiptPath(root: string, adapterId: ProofloopAgentAdapterId): string;
