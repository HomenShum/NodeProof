/**
 * The canonical one-prompt kickoff (`proofloop prompt`).
 *
 * HONESTY CONSTRAINT: this prompt may reference ONLY commands this package
 * actually implements. A test grep-asserts that every `proofloop <cmd>`
 * mentioned here is a real command.
 */
/**
 * The set of top-level commands the package CLI implements.
 *
 * `run` is the durable long-run benchmark executor (`proofloop run
 * init|start|resume|status|report`). It is deliberately NOT advertised in the
 * kickoff prompt below: the kickoff is the gate loop contract, and the
 * long-run executor is an operator tool, not something a worker agent should
 * reach for mid-loop.
 */
export declare const PACKAGE_COMMANDS: readonly ["init", "doctor", "gate", "hooks", "tooluse", "ci", "manifest", "docs", "template", "workflow", "ui", "resume", "report", "charts", "mcp", "run", "prompt", "this-repo"];
export declare function proofloopKickoffPrompt(): string;
