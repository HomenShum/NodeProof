/**
 * The canonical one-prompt kickoff (`proofloop prompt`).
 *
 * HONESTY CONSTRAINT: this prompt may reference ONLY commands this package
 * actually implements. A test grep-asserts that every `proofloop <cmd>`
 * mentioned here is a real command.
 */
/** The set of top-level commands the package CLI implements. */
export declare const PACKAGE_COMMANDS: readonly ["init", "doctor", "gate", "hooks", "tooluse", "ci", "manifest", "docs", "template", "workflow", "ui", "resume", "report", "charts", "mcp", "prompt", "this-repo"];
export declare function proofloopKickoffPrompt(): string;
