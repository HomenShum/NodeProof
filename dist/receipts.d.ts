export type ReceiptKind = "nodeagent-ingestion";
export interface ReceiptCheck {
    name: string;
    ok: boolean;
    detail: string;
}
export interface ReceiptVerification {
    ok: boolean;
    kind: ReceiptKind;
    receiptPath: string;
    checks: ReceiptCheck[];
    summary: {
        documentsCreated?: number;
        memoryObjectsCreated?: number;
        failedSources?: number;
        failedChunks?: number;
    };
}
export interface VerifyReceiptFileOptions {
    root: string;
    filePath: string;
    kind?: ReceiptKind;
    minDocuments?: number;
    minMemoryObjects?: number;
}
export declare function verifyReceiptFile(options: VerifyReceiptFileOptions): ReceiptVerification;
export declare function formatReceiptVerification(result: ReceiptVerification): string;
export declare function runReceiptVerify(options: VerifyReceiptFileOptions & {
    json?: boolean;
    log?: (message: string) => void;
    logError?: (message: string) => void;
}): number;
