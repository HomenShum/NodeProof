import { type ProofReceiptEnvelope } from "./proofReceipt";
export interface EaseProofVerification {
    ok: boolean;
    easeCertified: boolean;
    errors: string[];
    warnings: string[];
    manifestPath: string;
    browserManifestPath?: string;
    checkedScreenshots: number;
    checkedReplayArtifacts: number;
    envelope?: ProofReceiptEnvelope;
    outputPath?: string;
}
export declare function verifyEaseProof(options: {
    root: string;
    manifestPath: string;
    outputPath?: string;
}): EaseProofVerification;
export declare function runEaseProofVerify(options: {
    root: string;
    manifestPath: string;
    outputPath?: string;
    json?: boolean;
}): number;
