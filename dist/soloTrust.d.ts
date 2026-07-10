export type SoloTrustIssuerKind = "github-actions" | "hosted-worker";
export type SoloTrustPayload = {
    schema: "proofloop-solo-trust-payload-v1";
    issuedAt: string;
    programId: string;
    goalId: string;
    candidateCommit: string;
    claimTier: string;
    boundary: string;
    envelopeSha256: string;
    gateReceiptSha256: string;
    gateStatus: "passed";
    issuer: {
        kind: SoloTrustIssuerKind;
        repository: string;
        workflow: string;
        runId: string;
        runAttempt: string;
        actor: string;
    };
};
export type SoloTrustReceipt = {
    schema: "proofloop-solo-trust-root-receipt-v1";
    algorithm: "Ed25519";
    keyId: string;
    payload: SoloTrustPayload;
    signature: string;
};
export type SoloTrustEnvironment = Record<string, string | undefined>;
export type CreateSoloTrustReceiptOptions = {
    envelopePath: string;
    gateReceiptPath: string;
    privateKeyPem: string;
    keyId: string;
    outPath?: string;
    now?: string;
    environment?: SoloTrustEnvironment;
    issuerKind?: SoloTrustIssuerKind;
    allowLocalTest?: boolean;
};
export type VerifySoloTrustReceiptOptions = {
    publicKeyPem: string;
    expectedKeyId?: string;
    expectedCandidateCommit?: string;
    expectedRepository?: string;
    expectedIssuerKind?: SoloTrustIssuerKind;
};
export declare function createSoloTrustReceipt(options: CreateSoloTrustReceiptOptions): SoloTrustReceipt;
export declare function verifySoloTrustReceipt(receipt: SoloTrustReceipt, options: VerifySoloTrustReceiptOptions): {
    ok: boolean;
    errors: string[];
};
export declare function readSoloTrustReceipt(path: string): SoloTrustReceipt;
