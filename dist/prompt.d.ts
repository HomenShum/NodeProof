/**
 * The canonical one-prompt kickoff (`proofloop prompt`).
 *
 * HONESTY CONSTRAINT: this prompt may reference ONLY commands this package
 * actually implements -- init, doctor, gate, hooks, tooluse, ci, prompt,
 * this-repo. A test grep-asserts that every `proofloop <cmd>` mentioned here is
 * a real command. The noderoom kickoff referenced goal/supervise/run/resume,
 * which this portable core does NOT ship; those are the reference
 * implementation's, not this package's.
 */
/** The set of top-level commands the package CLI implements. */
export declare const PACKAGE_COMMANDS: readonly ["init", "doctor", "gate", "hooks", "tooluse", "ci", "prompt", "this-repo"];
export declare function proofloopKickoffPrompt(): string;
