"use strict";
/**
 * The canonical one-prompt kickoff (`proofloop prompt`).
 *
 * HONESTY CONSTRAINT: this prompt may reference ONLY commands this package
 * actually implements. A test grep-asserts that every `proofloop <cmd>`
 * mentioned here is a real command.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PACKAGE_COMMANDS = void 0;
exports.proofloopKickoffPrompt = proofloopKickoffPrompt;
/** The set of top-level commands the package CLI implements. */
exports.PACKAGE_COMMANDS = [
    "init",
    "doctor",
    "gate",
    "hooks",
    "tooluse",
    "ci",
    "manifest",
    "docs",
    "template",
    "workflow",
    "ui",
    "resume",
    "report",
    "charts",
    "mcp",
    "prompt",
    "this-repo",
];
function proofloopKickoffPrompt() {
    return [
        "Use Proof Loop on this repo: one prompt starts the loop; the proof gate decides when it is done.",
        "",
        "1. Set up once: `proofloop init` writes proofloop.config.json. For agent-friendly setup use",
        "   `proofloop init --agent auto --live` to add manifest, agent docs, scripts, workflows, and rubrics.",
        "2. Add real checks to proofloop.config.json gate.checks -- each is a shell command that must exit 0",
        "   to count as proof the app actually works (build, tests, a live user-workflow check). Define the",
        "   gate BEFORE installing hooks: once `proofloop hooks install` runs, proofloop.config.json is",
        "   locked against agent edits (the gate definition is not the agent's to move).",
        "3. Do the work in this repo, then prove it: `proofloop gate` runs every check and records the verdict.",
        "4. Done is not your call: do not stop until `proofloop gate` exits 0 (status: passed).",
        "5. Never weaken the gate: do not lower thresholds, skip evidence, disable checks, or edit the",
        "   protected paths (.proofloop/, proofloop.config.json, .github/workflows/). Fix the work, not",
        "   the gate.",
        "6. Inspect only the slice you need: `proofloop manifest`, `proofloop ui`, `proofloop resume`,",
        "   `proofloop report`, and `proofloop charts` give compact proof state without loading old transcripts.",
        "7. Contract the tools too (optional): `proofloop tooluse verify` checks the captured tool log against",
        "   an expected-tool-use contract (e.g. an MCP agent MUST fetch before it sends, MUST NOT delete).",
        "8. Check where you are anytime: `proofloop doctor` reports environment + readiness. Optional:",
        "   `proofloop mcp` exposes the same compact read-only surfaces to MCP clients; keep CLI primary.",
        "",
        "Mechanical enforcement for Claude Code is available: `proofloop hooks install` wires a Stop hook",
        "that refuses fake \"done\" until the gate passes, a PreToolUse guard against editing the gate/proof",
        "state, and a PostToolUse tool-use logger. `proofloop ci install github` makes the gate red/green on PRs.",
    ].join("\n");
}
