import type { ProofloopRunnerPlan } from "./runner";
export type ProofloopLayeredRunnerPlan = ProofloopRunnerPlan & {
    mode: "two-layer-certification-v1";
    generatedAt: string;
    goal?: string;
    summary: {
        setupTasks: number;
        capabilityTasks: number;
        browserTasks: number;
        totalTasks: number;
        browserRequiredForAllCapabilityTasks: false;
    };
    notes: string[];
};
export type ProofloopLayeredPlanResult = {
    planPath: string;
    plan: ProofloopLayeredRunnerPlan;
};
export declare function buildProofloopLayeredRunnerPlan(rootInput: string, options?: {
    goal?: string;
}): ProofloopLayeredRunnerPlan;
export declare function writeProofloopLayeredRunnerPlan(rootInput: string, options?: {
    goal?: string;
    planPath?: string;
}): ProofloopLayeredPlanResult;
export declare function defaultLayeredPlanPath(rootInput: string): string;
