export type ThisRepoIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
/** Exit 0 always (this is a guided setup, not a gate). */
export declare function runThisRepo(options: {
    root: string;
    goal?: string;
    live?: boolean;
} & ThisRepoIo): 0;
