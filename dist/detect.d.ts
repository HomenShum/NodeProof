export type AppDetection = {
    app: string;
    /** Human-readable evidence for why we picked this app. */
    reason: string;
};
/**
 * Detect the app framework. Order matters: Next.js and Vite are more specific
 * than a bare React dependency, so they win. Python markers are checked when
 * there is no informative package.json.
 */
export declare function detectApp(root: string): AppDetection;
/**
 * Best-effort one-line workflow hint from package.json description/name.
 * Empty string when nothing informative is available -- the user fills it in.
 */
export declare function detectWorkflowHint(root: string): string;
export type WorkerDetection = {
    name: string;
    onPath: boolean;
    /** Resolved path when found (best-effort). */
    location?: string;
};
/** The coding-agent worker CLIs the package knows how to talk about. */
export declare const KNOWN_WORKERS: readonly ["claude", "codex"];
/**
 * Detect which worker CLIs are on PATH. Uses `where` on Windows and `which`
 * elsewhere; both are cross-platform-safe via spawnSync (no shell).
 */
export declare function detectWorkers(workers?: readonly string[]): WorkerDetection[];
/** Is this directory inside a git working tree? */
export declare function isGitRepo(root: string): boolean;
/** Is git itself available on PATH? */
export declare function isGitAvailable(): boolean;
