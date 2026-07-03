import { type ProofloopAgentTarget } from "./project";
export type InitCliIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
};
export type InitOptions = {
    root: string;
    agent?: ProofloopAgentTarget;
    live?: boolean;
    features?: string[];
} & InitCliIo;
/** Exit code: 0 always (init is non-destructive; existing config is fine). */
export declare function runInit(options: InitOptions): 0;
