/**
 * NodeKit's generated applications currently emit `nodekit.proof-receipt/v1`
 * as their local/release proof. That receipt is useful, but it does not carry
 * the candidate commit or compiled application identity itself. This module
 * binds the receipt to the checked-out candidate and the compiler outputs
 * before a ProofLoop program may treat it as a passing arc.
 *
 * This is intentionally local-only. It does not deploy, invoke providers, or
 * create a promotion claim. It verifies bytes already present in the project.
 */
export declare const NODEKIT_PROOF_RECEIPT_SCHEMA: "nodekit.proof-receipt/v1";
export declare const NODEKIT_COMPILED_DEFINITION_SCHEMA: "nodeagent.resolved/v1";
export declare const NODEKIT_DISCOVERY_SCHEMA: "nodeagent.discovery/v1";
export type NodekitProofMinimumLevel = "local-ready" | "release-ready";
export type VerifyNodekitProofBindingOptions = {
    root: string;
    releaseProofPath: string;
    candidateCommit: string;
    minimumLevel?: NodekitProofMinimumLevel;
    compiledDefinitionPath?: string;
    configHashPath?: string;
    discoveryPath?: string;
};
export type NodekitProofGateReceipt = {
    id: string;
    path: string;
    sha256?: string;
    ok: boolean;
    errors: string[];
};
export type NodekitProofApplicationIdentity = {
    configHash: string;
    manifestDigest: string;
    discoveryDigest: string;
    fileCount: number;
    candidateCommit: string;
    observedCandidateCommit?: string;
};
export type NodekitProofBindingVerification = {
    schema: "proofloop-nodekit-proof-binding-v1";
    ok: boolean;
    releaseProofPath: string;
    candidateCommit: string;
    minimumLevel: NodekitProofMinimumLevel;
    errors: string[];
    gateReceipts: NodekitProofGateReceipt[];
    identity?: NodekitProofApplicationIdentity;
};
/**
 * Verify a generated NodeKit local/release proof against compiler outputs and
 * the current Git candidate. The result is evidence only; callers decide how
 * it contributes to a larger program verdict.
 */
export declare function verifyNodekitProofBinding(options: VerifyNodekitProofBindingOptions): NodekitProofBindingVerification;
export declare function formatNodekitProofBindingVerification(result: NodekitProofBindingVerification): string;
export declare function runNodekitProofBindingVerify(options: VerifyNodekitProofBindingOptions & {
    json?: boolean;
    log?: (message: string) => void;
    logError?: (message: string) => void;
}): number;
