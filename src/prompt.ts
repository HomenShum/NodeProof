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
export const PACKAGE_COMMANDS = [
  "init",
  "doctor",
  "gate",
  "hooks",
  "tooluse",
  "ci",
  "prompt",
  "this-repo",
] as const;

export function proofloopKickoffPrompt(): string {
  return [
    "Use Proof Loop on this repo: one prompt starts the loop; the proof gate decides when it is done.",
    "",
    "1. Set up once: `proofloop init` writes proofloop.config.json (app + intended workflow + gate.checks).",
    "2. Add real checks to proofloop.config.json gate.checks -- each is a shell command that must exit 0",
    "   to count as proof the app actually works (build, tests, a live user-workflow check). Define the",
    "   gate BEFORE installing hooks: once `proofloop hooks install` runs, proofloop.config.json is",
    "   locked against agent edits (the gate definition is not the agent's to move).",
    "3. Do the work in this repo, then prove it: `proofloop gate` runs every check and records the verdict.",
    "4. Done is not your call: do not stop until `proofloop gate` exits 0 (status: passed).",
    "5. Never weaken the gate: do not lower thresholds, skip evidence, disable checks, or edit the",
    "   protected paths (.proofloop/, proofloop.config.json, .github/workflows/). Fix the work, not",
    "   the gate.",
    "6. Contract the tools too (optional): `proofloop tooluse verify` checks the captured tool log against",
    "   an expected-tool-use contract (e.g. an MCP agent MUST fetch before it sends, MUST NOT delete).",
    "7. Check where you are anytime: `proofloop doctor` reports environment + readiness.",
    "",
    "Mechanical enforcement for Claude Code is available: `proofloop hooks install` wires a Stop hook",
    "that refuses fake \"done\" until the gate passes, a PreToolUse guard against editing the gate/proof",
    "state, and a PostToolUse tool-use logger. `proofloop ci install github` makes the gate red/green on PRs.",
  ].join("\n");
}
