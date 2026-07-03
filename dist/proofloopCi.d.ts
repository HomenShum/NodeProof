export declare const PROOFLOOP_CI_TEMPLATE_FILENAME = "github-proofloop-gate.yml";
export declare const PROOFLOOP_CI_WORKFLOW_RELPATH = ".github/workflows/proofloop-gate.yml";
export type ProofloopCiInstallOptions = {
    /** Target repo root the workflow is written into. Default: cwd. */
    root?: string;
    /**
     * Directory that contains the shipped template. Default: the package's
     * `templates/` dir, located relative to this compiled module.
     */
    templateDir?: string;
};
export type ProofloopCiInstallResult = {
    root: string;
    templatePath: string;
    workflowPath: string;
};
/**
 * Resolve the package's bundled templates/ directory. This file compiles to
 * dist/proofloopCi.js (CommonJS), so __dirname is dist/ and templates/ is one
 * level up.
 */
export declare function defaultTemplateDir(): string;
export declare function installProofloopGithubCi(options?: ProofloopCiInstallOptions): ProofloopCiInstallResult;
