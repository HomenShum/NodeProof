export declare const MINIMUM_NODE_MAJOR = 20;
export type DoctorReport = {
    node: {
        version: string;
        major: number;
        ok: boolean;
    };
    git: {
        available: boolean;
        isRepo: boolean;
    };
    workers: {
        name: string;
        onPath: boolean;
        location?: string;
    }[];
    claudeDirExists: boolean;
    hooksInstalled: boolean;
    configExists: boolean;
    ready: boolean;
    missing: string[];
};
export declare function buildDoctorReport(root: string): DoctorReport;
export declare function formatDoctorReport(report: DoctorReport): string;
/** Exit 0 always. */
export declare function runDoctor(options: {
    root: string;
    log?: (line: string) => void;
}): 0;
