"use strict";
/**
 * Verifier-weakening patterns + protected-path defaults for the portable
 * Proof Loop package.
 *
 * PORTED from the noderoom reference implementation
 * (src/eval/scaffoldProposal.ts). VERIFIER_WEAKENING_PATTERNS is copied
 * VERBATIM -- these are the load-bearing regexes the PreToolUse guard scans
 * new file content against.
 *
 * KEY DIFFERENCE from noderoom: noderoom's IMMUTABLE_FILES lists that repo's
 * OWN harness files (scripts/proofloop.mjs, tests/harnessChangeEval.test.ts,
 * src/eval/evalTrustPolicy.ts, .github/workflows/, ...). A STRANGER'S repo has
 * none of those, so shipping that list as a default would be meaningless (or
 * worse, block edits to files that do not exist and confuse users). Instead:
 *
 *   - DEFAULT_IMMUTABLE_FILES is EMPTY. The user declares repo-specific
 *     immutable paths in proofloop.config.json `immutable: []`.
 *   - DEFAULT_PROTECTED_EXTRA_PATHS is the GENERIC proof-state set every repo
 *     using Proof Loop shares: the gitignored/enforcement-critical paths that
 *     git-diff-based review structurally cannot see an agent rewriting.
 *
 * The hooks installer merges the config `immutable: []` into `immutableFiles`
 * and always keeps DEFAULT_PROTECTED_EXTRA_PATHS in `protectedExtraPaths`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROTECTED_EXTRA_PATHS = exports.DEFAULT_IMMUTABLE_FILES = exports.VERIFIER_WEAKENING_PATTERNS = void 0;
/**
 * Patterns that indicate a change weakens the verifier. Copied VERBATIM from
 * noderoom src/eval/scaffoldProposal.ts VERIFIER_WEAKENING_PATTERNS. The
 * PreToolUse guard snapshots these into its config so it never drifts from a
 * hand-maintained duplicate.
 */
exports.VERIFIER_WEAKENING_PATTERNS = [
    /minScore\s*[:=]\s*\d+/i, // lowering minScore
    /lower\s+minScore/i, // "lower minScore"
    /remove.*required.*check/i,
    /skip.*evidence/i,
    /hide.*failing/i,
    /disable.*gate/i,
    /bypass.*assertion/i,
];
/**
 * Package default for immutable files. EMPTY on purpose: a stranger's repo has
 * no noderoom harness files. Users add their own via proofloop.config.json
 * `immutable: []` (e.g. "src/eval/", ".github/workflows/ci.yml").
 */
exports.DEFAULT_IMMUTABLE_FILES = [];
/**
 * Generic proof-state paths the PreToolUse guard refuses to edit in ANY repo.
 * These are gitignored or enforcement-critical, so a git-diff-based
 * immutability review can never see an agent rewriting them. The three broad
 * defaults (prefix semantics):
 *   - ".proofloop/"           : ALL local proof state -- the gate verdict
 *     (.proofloop/gate-state.json the Stop hook trusts in check-only mode: one
 *     forged Write there would fake a PASS), the hook enforcement layer
 *     (.proofloop/hooks/ config, counters, scripts), the PostToolUse capture
 *     log (.proofloop/tooluse/ -- doctoring your own log = reward hacking),
 *     and regression history (.proofloop/regressions*).
 *   - "proofloop.config.json" : the gate DEFINITION. An agent that can edit
 *     gate.checks, immutable, or protectedPaths can un-protect everything
 *     else and move its own goalpost.
 *   - ".github/workflows/"    : the CI backstop that re-verifies the gate
 *     (includes the proofloop-gate.yml written by `proofloop ci install
 *     github`).
 * The narrower entries below are subsumed by the prefixes above; they are kept
 * explicitly so each carries its own rationale (and so tooling/tests can
 * reference them individually). Users ADD paths via proofloop.config.json
 * `protectedPaths: []`; the defaults are not removable.
 * Known bypass: Bash-issued writes are not intercepted by this guard; CI
 * re-verification is the backstop.
 */
exports.DEFAULT_PROTECTED_EXTRA_PATHS = [
    ".proofloop/",
    "proofloop.config.json",
    ".github/workflows/",
    // Subsumed by the prefixes above -- kept for explicit, documented intent:
    ".proofloop/regressions.json",
    ".proofloop/regressions/",
    ".proofloop/tooluse/",
    ".proofloop/hooks/",
    ".github/workflows/proofloop-gate.yml",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".codex/hooks.json",
    ".codex/hooks.local.json",
];
