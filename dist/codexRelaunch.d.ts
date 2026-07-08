import type { ProofloopVerdict } from "./agentAdapters";
export type ProofloopCodexRelaunchPacket = {
    schema: "proofloop-codex-relaunch-v1";
    generatedAt: string;
    runId: string;
    suite: string;
    passed: false;
    failure: {
        exitCode: number;
        failedGates: string[];
        score?: number;
        minScore?: number;
    };
    receipts: {
        repairPrompt: string;
        proofReceipts: string[];
    };
    commands: {
        gate: string;
        codexReprompt: string;
        codexRelaunch: string;
        installCodexHooks: string;
    };
    codexPrompt: string;
};
export type ProofloopCodexRelaunchResult = {
    wrote: boolean;
    packetPath: string;
    promptPath: string;
    packet?: ProofloopCodexRelaunchPacket;
};
export declare function writeCodexRelaunchPacket(args: {
    root?: string;
    runDir: string;
    verdict: ProofloopVerdict;
    repairPromptPath: string;
    force?: boolean;
}): ProofloopCodexRelaunchResult;
export declare function readCodexReprompt(path: string): string;
export declare function codexRunDir(root: string, runId: string): string;
export declare function latestProofloopRunDir(root: string): string | undefined;
