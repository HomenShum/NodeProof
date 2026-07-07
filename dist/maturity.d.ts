export type AgentEraLevelId = 0 | 1 | 2 | 3 | 4 | 5;
export type AgentEraCapabilityStatus = "met" | "partial" | "missing";
export type AgentEraCapability = {
    id: string;
    level: AgentEraLevelId;
    title: string;
    status: AgentEraCapabilityStatus;
    evidence: string[];
    missing: string[];
    recommendation: string;
};
export type AgentEraLevelAssessment = {
    level: AgentEraLevelId;
    title: string;
    description: string;
    requiredCapabilityIds: string[];
    status: AgentEraCapabilityStatus;
};
export type AgentEraMaturityReport = {
    schema: "proofloop-agent-era-maturity-v1";
    generatedAt: string;
    root: string;
    repoName: string;
    currentLevel: AgentEraLevelId;
    currentStage: string;
    targetLevel: AgentEraLevelId;
    score: number;
    levelAssessments: AgentEraLevelAssessment[];
    capabilities: AgentEraCapability[];
    missing: string[];
    nextActions: string[];
    timelineMermaid: string;
    projectionMermaid: string;
    reportMarkdown: string;
};
export type AgentEraMaturityOptions = {
    root: string;
    targetLevel?: number;
    generatedAt?: string;
};
export type WriteAgentEraMaturityResult = {
    report: AgentEraMaturityReport;
    markdownPath: string;
    jsonPath: string;
};
export declare function assessAgentEraMaturity(options: AgentEraMaturityOptions): AgentEraMaturityReport;
export declare function writeAgentEraMaturityReport(options: AgentEraMaturityOptions & {
    outPath?: string;
}): WriteAgentEraMaturityResult;
export declare function formatAgentEraMaturityDense(report: AgentEraMaturityReport): string;
