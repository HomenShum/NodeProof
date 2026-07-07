export type ProductivityBaselineSource = "measured" | "historical" | "benchmark" | "research" | "estimated";
export type ProductivityProofVerdict = "pass" | "partial" | "fail" | "blocked";
export type ProductivityRole = "software_developer" | "qa_tester" | "researcher" | "designer";
export type ProductivityEvidenceRow = {
    sourceFile: string;
    sourceField: string;
    confidence: number;
    method: string;
    citation: string;
};
export type WageRate = {
    role: ProductivityRole;
    hourlyUsd: number;
    sourceName: string;
    sourceUrl: string;
    geography: string;
    evidence: ProductivityEvidenceRow;
};
export type ProductivityLedger = {
    schema: "proofloop-productivity-ledger-v1";
    runId: string;
    workflowId: string;
    generatedAt: string;
    baseline: {
        source: ProductivityBaselineSource;
        devHours: number;
        qaHours: number;
        researchHours: number;
        designerHours: number;
        confidence: number;
        evidence: ProductivityEvidenceRow[];
    };
    wageRates: WageRate[];
    actual: {
        humanReviewHours: number;
        modelCostUsd: number;
        browserCostUsd: number;
        ciCostUsd: number;
        evidence: ProductivityEvidenceRow[];
    };
    proof: {
        verdict: ProductivityProofVerdict;
        regressionAdded: boolean;
        liveBrowserVerified: boolean;
        deterministicGateAdded: boolean;
        evidence: ProductivityEvidenceRow[];
    };
    value: {
        grossWageEquivalentUsd: number;
        humanReviewCostUsd: number;
        totalRunCostUsd: number;
        netWageEquivalentUsd: number;
        confidenceAdjustedUsd: number;
        costPerPassedProofUsd: number | null;
        evidence: ProductivityEvidenceRow[];
    };
    dimensions: {
        timeSavedHours: number;
        verifiedTaskCompletion: number;
        regressionProtection: number;
        costPerPassedProofUsd: number | null;
        deliveryReliability: number;
    };
    caveat: string;
};
export type ProductivityProofPack = {
    ledger: ProductivityLedger;
    wageResearch: {
        schema: "proofloop-wage-research-v1";
        generatedAt: string;
        rates: WageRate[];
        notes: string[];
    };
    baselineEstimates: {
        schema: "proofloop-baseline-estimates-v1";
        runId: string;
        workflowId: string;
        source: ProductivityBaselineSource;
        confidence: number;
        rows: ProductivityEvidenceRow[];
    };
    scorecardMarkdown: string;
    charts: Record<string, VegaLiteChart>;
};
export type ProductivityProofPackOptions = {
    root: string;
    runId?: string;
    workflowId?: string;
    baselineSource?: ProductivityBaselineSource;
    devHours?: number;
    qaHours?: number;
    researchHours?: number;
    designerHours?: number;
    confidence?: number;
    humanReviewHours?: number;
    modelCostUsd?: number;
    browserCostUsd?: number;
    ciCostUsd?: number;
    regressionAdded?: boolean;
    liveBrowserVerified?: boolean;
    deterministicGateAdded?: boolean;
    generatedAt?: string;
};
export type WriteProductivityProofPackResult = {
    pack: ProductivityProofPack;
    runDir: string;
    files: {
        ledger: string;
        wageResearch: string;
        baselineEstimates: string;
        scorecard: string;
        charts: string[];
    };
};
type VegaLiteChart = {
    $schema: string;
    title: string;
    data: {
        values: Array<Record<string, unknown>>;
    };
    mark: string | Record<string, unknown>;
    encoding: Record<string, unknown>;
};
export declare function buildProductivityProofPack(options: ProductivityProofPackOptions): ProductivityProofPack;
export declare function writeProductivityProofPack(options: ProductivityProofPackOptions & {
    outDir?: string;
}): WriteProductivityProofPackResult;
export declare function formatProductivityDense(pack: ProductivityProofPack, runDir?: string): string;
export {};
