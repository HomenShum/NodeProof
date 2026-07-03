export declare const CONFIG_FILENAME = "proofloop.config.json";
export type ProofloopGateCheck = {
    name: string;
    command: string;
};
export type ProofloopConfig = {
    app: string;
    workflow: string;
    gate: {
        checks: ProofloopGateCheck[];
    };
    immutable: string[];
    /** User ADDITIONS to the guard's default protected paths (never replaces them). */
    protectedPaths: string[];
};
export declare function configPath(root: string): string;
export declare function configExists(root: string): boolean;
/**
 * Read + normalize the config. Returns undefined when the file is absent.
 * Throws on unparseable JSON so we never silently run on a broken config.
 */
export declare function readConfig(root: string): ProofloopConfig | undefined;
/** Coerce an arbitrary parsed value into a well-formed ProofloopConfig. */
export declare function normalizeConfig(value: unknown): ProofloopConfig;
export declare function serializeConfig(config: ProofloopConfig): string;
