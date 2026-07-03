export type ProofloopAgentKind = "codex" | "claude" | "cursor" | "windsurf";
export type ProofloopAgentTarget = ProofloopAgentKind | "auto" | "all";
export type UiContract = {
    id: string;
    selector: string;
    source: string;
    actions: string[];
    assertions: string[];
};
export type ProofloopProjectManifest = {
    schema: "proofloop-project-manifest-v1";
    generatedAt: string;
    repo: {
        name: string;
        root: string;
        app: string;
        appReason: string;
        stack: string[];
    };
    commands: Record<string, string>;
    packageScripts: Record<string, string>;
    agentInstructions: {
        agent: ProofloopAgentKind;
        path: string;
        exists: boolean;
    }[];
    workflows: string[];
    proofGates: {
        name: string;
        command: string;
    }[];
    uiContracts: UiContract[];
    knownBlockers: string[];
};
export type ProjectTemplate = {
    id: string;
    title: string;
    workflow: string;
    checks: {
        name: string;
        command: string;
    }[];
    selectors: string[];
};
export declare function resolveProofloopAgentTargets(root: string, target?: ProofloopAgentTarget): ProofloopAgentKind[];
export declare function writeProofloopAgentDocs(root: string, target?: ProofloopAgentTarget): string[];
export declare function syncProofloopPackageScripts(root: string): {
    path?: string;
    changed: boolean;
    scripts: Record<string, string>;
};
export declare function buildProofloopProjectManifest(root: string): ProofloopProjectManifest;
export declare function writeProofloopProjectManifest(root: string): string;
export declare function formatProofloopProjectManifestDense(manifest: ProofloopProjectManifest): string;
export declare function discoverUiContracts(root: string): UiContract[];
export declare function formatUiContractsDense(contracts: UiContract[]): string;
export declare function listProofloopTemplates(): ProjectTemplate[];
export declare function formatProofloopTemplateList(templates?: ProjectTemplate[]): string;
export declare function writeProofloopTemplate(root: string, id: string, force?: boolean): string[];
export declare function writeProofloopLiveScaffold(root: string): string[];
export declare function listProofloopWorkflows(root: string): string[];
export declare function buildResume(root: string): {
    dense: string;
    json: Record<string, unknown>;
};
export declare function buildReport(root: string): {
    text: string;
    json: Record<string, unknown>;
};
export declare function writeProofloopCharts(root: string): {
    jsonPath: string;
    svgPath: string;
};
