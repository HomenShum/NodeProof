import type { ProofloopTargetPlan } from "./targetPlan";
export type ProofloopContextReportResult = {
    reportPath: string;
    latestPath: string;
    text: string;
};
export type ProofloopContextReportInputs = {
    root: string;
    targetPlan: ProofloopTargetPlan;
    targetPlanPath: string;
    runnerPlanPath?: string;
    generatedAt?: string;
};
export declare function writeProofloopContextReport(inputs: ProofloopContextReportInputs): ProofloopContextReportResult;
export declare function renderProofloopContextReport(inputs: ProofloopContextReportInputs & {
    generatedAt: string;
}): string;
