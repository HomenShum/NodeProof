import { type ProofloopBenchmarkRecommendation } from "./targetPlan";
export declare const HOSTED_SCHEMA_VERSION = "proofloop-hosted-run-v1";
export type HostedAppType = "agent-app" | "chat-agent" | "workflow-agent" | "spreadsheet-agent" | "research-copilot" | "underwriting-agent" | "accounting-agent" | "document-memory" | "custom";
export type HostedAuthMode = "none" | "manual-login" | "test-account" | "session-replay";
export type HostedVisibility = "private" | "public";
export type HostedVerificationStatus = "verified" | "pending" | "blocked";
export type HostedRunRequest = {
    schema: typeof HOSTED_SCHEMA_VERSION;
    createdAt: string;
    targetUrl: string;
    appType: HostedAppType;
    intendedAudience: string;
    primaryGoal: string;
    authMode: HostedAuthMode;
    authNotes: string;
    modelBudgetUsd: number;
    requestedBenchmarkFamilies: string[];
    consent: {
        accepted: boolean;
        ownsOrAuthorized: boolean;
        allowBrowserAutomation: boolean;
        allowRecording: boolean;
        contactEmail?: string;
    };
    visibility: HostedVisibility;
};
export type HostedDomainPermission = {
    status: HostedVerificationStatus;
    host: string;
    method: "allowlist" | "well-known-token" | "dns-token" | "manual-review";
    token: string;
    evidence: string[];
    blockers: string[];
};
export type HostedSuccessContract = {
    schema: "proofloop-hosted-success-contract-v1";
    contractId: string;
    targetUrl: string;
    appType: HostedAppType;
    success: {
        minimumAdaptiveSteps: number;
        forbiddenUrlIncludes: string[];
        visibleTextAny: string[];
        visibleTestIdAny: string[];
        urlIncludesAny: string[];
        requireNoBrowserProblems: boolean;
        requireVisualProof: boolean;
    };
    benchmarkProxyTasks: HostedBenchmarkProxyTask[];
};
export type HostedBenchmarkProxyTask = {
    id: string;
    family: string;
    title: string;
    audience: string;
    prompt: string;
    successSignal: string;
    officialBoundary: "proxy_product_path" | "official_scorer_required";
};
export type HostedRunBundle = {
    schema: "proofloop-hosted-run-bundle-v1";
    runId: string;
    generatedAt: string;
    request: HostedRunRequest;
    permission: HostedDomainPermission;
    contract: HostedSuccessContract;
    recommendations: ProofloopBenchmarkRecommendation[];
    runner: {
        mode: "external-managed-worker";
        reason: string;
        queuePath: string;
        artifactRoot: string;
        resumeCommand: string;
        nodeRoomDogfoodCommand: string;
    };
    artifactContract: {
        receipt: string;
        screenshot: string;
        video: string;
        trace: string;
        scorecard: string;
        dashboard: string;
    };
    dashboardHtml: string;
};
export type HostedRunQueueItem = {
    runId: string;
    requestPath?: string;
    bundlePath?: string;
};
export type HostedWorkerPlan = {
    schema: "proofloop-hosted-worker-plan-v1";
    generatedAt: string;
    runId: string;
    status: "ready_for_managed_worker" | "blocked";
    blockers: string[];
    warnings: string[];
    targetUrl: string;
    appType: HostedAppType;
    permission: HostedDomainPermission;
    successContract: HostedSuccessContract["success"];
    benchmarkProxyTasks: HostedBenchmarkProxyTask[];
    artifactContract: HostedRunBundle["artifactContract"];
    worker: {
        mode: "external-managed-worker";
        requiredCapabilities: string[];
        queuePath: string;
        artifactRoot: string;
        nodeRoomDogfoodCommand?: string;
    };
    nextActions: string[];
};
export type HostedIntakeOptions = {
    targetUrl: string;
    appType?: HostedAppType;
    intendedAudience?: string;
    primaryGoal?: string;
    authMode?: HostedAuthMode;
    authNotes?: string;
    budgetUsd?: number;
    families?: string[];
    consentAccepted?: boolean;
    ownsOrAuthorized?: boolean;
    allowBrowserAutomation?: boolean;
    allowRecording?: boolean;
    contactEmail?: string;
    visibility?: HostedVisibility;
    allowlistedHosts?: string[];
    generatedAt?: string;
};
export type WriteHostedRunBundleOptions = HostedIntakeOptions & {
    root?: string;
    outDir?: string;
};
export declare function createHostedRunRequest(options: HostedIntakeOptions): HostedRunRequest;
export declare function validateHostedRunRequest(request: HostedRunRequest, options?: {
    allowlistedHosts?: string[];
}): {
    ok: boolean;
    blockers: string[];
    warnings: string[];
};
export declare function verifyHostedDomainPermission(request: HostedRunRequest, options?: {
    allowlistedHosts?: string[];
}): HostedDomainPermission;
export declare function buildHostedSuccessContract(request: HostedRunRequest): HostedSuccessContract;
export declare function composeHostedBenchmarkProxyTasks(request: HostedRunRequest): HostedBenchmarkProxyTask[];
export declare function buildHostedRunBundle(options: HostedIntakeOptions): HostedRunBundle;
export declare function buildHostedRunBundleFromRequest(request: HostedRunRequest, options?: {
    allowlistedHosts?: string[];
}): HostedRunBundle;
export declare function readHostedBundleReference(path: string, options?: {
    root?: string;
}): HostedRunBundle;
export declare function buildHostedWorkerPlan(bundle: HostedRunBundle, options?: {
    generatedAt?: string;
}): HostedWorkerPlan;
export declare function writeHostedWorkerPlan(options: {
    requestFile: string;
    root?: string;
    outFile?: string;
    generatedAt?: string;
}): {
    bundle: HostedRunBundle;
    plan: HostedWorkerPlan;
    file: string;
};
export declare function writeHostedRunBundle(options: WriteHostedRunBundleOptions): {
    bundle: HostedRunBundle;
    files: string[];
};
export declare function renderHostedRunbook(bundle: HostedRunBundle): string;
export declare function renderHostedDashboardHtml(bundle: Omit<HostedRunBundle, "dashboardHtml">): string;
export declare function readHostedRunBundle(path: string): HostedRunBundle;
