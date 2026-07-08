import { type ProofloopAgentAdapterId } from "./agentAdapters";
export type ProofloopAgentLoopResult = {
    runId: string;
    exitCode: number;
    attempts: number;
    passed: boolean;
    runDir: string;
    repairPromptPath?: string;
};
export declare function runProofloopAgentLoop(options: {
    root?: string;
    agentId?: ProofloopAgentAdapterId;
    maxAttempts?: number;
    dryRun?: boolean;
    command?: string;
    runId?: string;
    log?: (line: string) => void;
    logError?: (line: string) => void;
}): Promise<ProofloopAgentLoopResult>;
