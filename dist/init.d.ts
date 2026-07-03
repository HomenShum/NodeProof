export type InitCliIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
/** Exit code: 0 always (init is non-destructive; existing config is fine). */
export declare function runInit(options: {
    root: string;
} & InitCliIo): 0;
