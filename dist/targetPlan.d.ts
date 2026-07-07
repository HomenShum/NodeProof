import type { ProofloopRunnerPlan } from "./runner";
export type ProofloopTargetKind = "codebase" | "live-url" | "hybrid";
export type ProofloopBenchmarkFit = "strong" | "medium" | "weak";
export type ProofloopAdapterStatus = "configured" | "candidate" | "blocked";
export type ProofloopBenchmarkRecommendation = {
    id: string;
    title: string;
    fit: ProofloopBenchmarkFit;
    confidence: number;
    adapterStatus: ProofloopAdapterStatus;
    officialScoreStatus: "configured_command" | "requires_adapter" | "not_bundled";
    evidence: string[];
    configuredScripts: Array<{
        name: string;
        command: string;
    }>;
    notes: string[];
};
export type ProofloopTargetPlan = {
    schema: "proofloop-target-plan-v1";
    generatedAt: string;
    target: {
        kind: ProofloopTargetKind;
        root?: string;
        url?: string;
        packageName?: string;
        httpStatus?: number;
        title?: string;
    };
    summary: {
        recommendedFamilies: number;
        configuredAdapters: number;
        blockedFamilies: number;
        liveUrlReachable: boolean | null;
        officialScoreReady: boolean;
        runnerPlanReady: boolean;
    };
    recommendations: ProofloopBenchmarkRecommendation[];
    runnerPlan?: ProofloopRunnerPlan;
    blocked: string[];
    nextActions: string[];
    honesty: string;
};
export type ProofloopTargetResult = {
    exitCode: number;
    plan: ProofloopTargetPlan;
    planPath: string;
    runnerPlanPath?: string;
};
export type ProofloopTargetOptions = {
    root: string;
    url?: string;
    outPath?: string;
    writeRunnerPlan?: boolean;
    json?: boolean;
    dense?: boolean;
    timeoutMs?: number;
    log?: (message: string) => void;
    logError?: (message: string) => void;
};
type TargetSignals = {
    root: string;
    packageName?: string;
    scripts: Record<string, string>;
    text: string;
    evidence: string[];
};
type UrlSignals = {
    url: string;
    ok: boolean;
    status?: number;
    title?: string;
    text: string;
    evidence: string[];
};
export declare function runProofloopTarget(options: ProofloopTargetOptions): Promise<ProofloopTargetResult>;
export declare function writeProofloopTargetPlan(options: ProofloopTargetOptions): Promise<ProofloopTargetResult>;
export declare function buildProofloopTargetPlan(args: {
    root: string;
    codebaseSignals?: TargetSignals;
    urlSignals?: UrlSignals;
    generatedAt?: string;
}): ProofloopTargetPlan;
export declare function classifyBenchmarkFamilies(textInput: string, scripts?: Record<string, string>, hasLiveUrl?: boolean, seedEvidence?: string[]): ProofloopBenchmarkRecommendation[];
export declare function formatProofloopTargetPlanDense(plan: ProofloopTargetPlan, planPath: string, runnerPlanPath?: string): string;
export {};
