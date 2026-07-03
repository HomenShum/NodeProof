export declare const GATE_STATE_RELATIVE_PATH = ".proofloop/gate-state.json";
export type GateStatus = "passed" | "failed" | "no_gate";
export type GateCheckResult = {
    name: string;
    command: string;
    pass: boolean;
    ms: number;
    exitCode: number | null;
};
export type GateState = {
    schema: "proofloop-gate-v1";
    status: GateStatus;
    checks: GateCheckResult[];
    ts: string;
    /** How the gate was assembled (config checks vs the npm-test fallback vs none). */
    source: "config-checks" | "npm-test-fallback" | "none";
};
export type GateCliIo = {
    log?: (line: string) => void;
    logError?: (line: string) => void;
    now?: () => Date;
};
export declare function gateStatePath(root: string): string;
/** Exit code from a gate status: passed=0, failed=1, no_gate=2 (unusable). */
export declare function statusToExit(status: GateStatus): 0 | 1 | 2;
/**
 * Run the gate. Returns the persisted GateState.
 * The IO `log`/`logError` are for CLI framing; check commands stream directly
 * to the parent stdio so the user sees real test output.
 */
export declare function runGate(options: {
    root: string;
} & GateCliIo): GateState;
/**
 * `proofloop gate [--check]`. Exit code: 0 passed, 1 failed, 2 no_gate/unusable.
 */
export declare function runGateCli(options: {
    root: string;
    check?: boolean;
} & GateCliIo): 0 | 1 | 2;
export declare function formatGateState(state: GateState, statePath: string, fromCache: boolean): string;
