export type ThisRepoIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
export type ThisRepoOptions = {
    root: string;
    goal?: string;
    live?: boolean;
    writeRunnerPlan?: boolean;
    run?: boolean;
    budgetUsd?: number;
    maxTasks?: number;
} & ThisRepoIo;
/** Exit 0 unless the optional runner is asked to execute and a task fails. */
export declare function runThisRepo(options: ThisRepoOptions): Promise<number>;
