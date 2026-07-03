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
    manifestExists: boolean;
    agentDocs: {
        path: string;
        exists: boolean;
    }[];
    packageScripts: {
        name: string;
        exists: boolean;
        command?: string;
    }[];
    playwright: {
        declared: boolean;
        configExists: boolean;
    };
    browserReady: boolean;
    githubWorkflowExists: boolean;
    uiContractsFound: number;
    ready: boolean;
    missing: string[];
    fixes: string[];
};
export declare function buildDoctorReport(root: string): DoctorReport;
export declare function formatDoctorReport(report: DoctorReport): string;
/** Exit 0 always. */
export declare function runDoctor(options: {
    root: string;
    json?: boolean;
    log?: (line: string) => void;
}): 0;
