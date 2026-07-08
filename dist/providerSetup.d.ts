export declare const PROOFLOOP_PROVIDER_IDS: readonly ["butterbase", "neo4j", "rocketride", "daytona", "cognee", "nebius"];
export type ProofloopProviderId = (typeof PROOFLOOP_PROVIDER_IDS)[number];
export type ProofloopProviderSetupStatus = "ready" | "needs_credentials" | "blocked";
export type ProofloopProviderSetupCheck = {
    id: string;
    status: ProofloopProviderSetupStatus;
    detail: string;
};
export type ProofloopProviderSetupReceipt = {
    schema: "proofloop-provider-setup-v1";
    providerId: ProofloopProviderId;
    generatedAt: string;
    status: ProofloopProviderSetupStatus;
    env: {
        required: string[];
        optional: string[];
        present: string[];
        missing: string[];
    };
    checks: ProofloopProviderSetupCheck[];
    nextCommands: string[];
};
export type ProofloopProviderSetupOptions = {
    root?: string;
    env?: NodeJS.ProcessEnv;
    generatedAt?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
export declare function setupProofloopProvider(providerId: ProofloopProviderId, options?: ProofloopProviderSetupOptions): Promise<ProofloopProviderSetupReceipt>;
export declare function setupProofloopProviders(providerIds?: ProofloopProviderId[], options?: ProofloopProviderSetupOptions): Promise<ProofloopProviderSetupReceipt[]>;
export declare function proofloopProviderReceiptPath(root: string, providerId: ProofloopProviderId): string;
export declare function parseProofloopProviderId(value: string): ProofloopProviderId;
