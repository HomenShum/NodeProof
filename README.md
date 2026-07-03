# Proof Loop

**Bring any coding agent. Proof Loop makes it prove the app works.**

Coding agents write code and say "done." Proof Loop is the supervisor that decides whether done is
true: it runs a gate against your app, refuses false completion, captures which tools your agent
actually called, and keeps proof state the agent cannot quietly weaken. One prompt starts the loop;
the gate decides when it is actually done.

Zero runtime dependencies. Node >= 20. Works on any repo.

## Quickstart

```bash
npx proofloop init --agent auto --live  # config + manifest + agent docs + scripts + live scaffold
npx proofloop doctor --json             # setup checks and fix commands
npx proofloop manifest --dense          # compact repo status for agents
npx proofloop ui contract --dense       # stable selectors/actions/assertions
npx proofloop prompt                    # kickoff prompt to paste into your coding agent
npx proofloop gate                      # run checks -> .proofloop/gate-state.json
```

Then make "done" honest for a Claude Code session:

```bash
npx proofloop hooks install
```

This installs a Stop hook that refuses to let the agent stop while the gate is failing, a PreToolUse
guard that blocks edits to proof/verifier state, and a PostToolUse logger for expected-tool-use
contracts. Uninstall with `proofloop hooks uninstall`.

Define the gate before installing hooks. Once hooks are installed, `proofloop.config.json` is itself
a protected path: the gate definition is not the agent's to move.

## Agent-Friendly Setup

`npx proofloop init --agent auto --live` follows the Astryx-style setup pattern:

- Writes `proofloop.config.json` if missing.
- Writes `.proofloop/manifest.json` with stack, commands, proof gates, workflows, UI contracts, and blockers.
- Adds or updates agent docs: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/proofloop.mdc`, and `.windsurf/rules/proofloop.md` when requested.
- Adds package aliases such as `proofloop:init`, `proofloop:gate`, `proofloop:resume`, and `proofloop:charts`.
- Creates live workflow/rubric starters under `proofloop/workflows/` and `proofloop/rubrics/`.

The CLI stays primary. `npx proofloop mcp` exposes the same compact read-only surfaces to MCP clients
without loading broad repo context.

## How The Stop Gate Decides

- Default check-only mode reads `.proofloop/gate-state.json` with no subprocess or network call.
- `passed` allows stop.
- `failed` blocks stop and prints the failing checks.
- No verdict yet or `no_gate` allows stop with an honest note so fresh repos are not bricked.
- Command mode is opt-in: `proofloop hooks install --gate-command "<cmd>"`.
- A per-session block counter prevents infinite refusal loops.

## Protected Paths

The PreToolUse guard refuses agent file-edit tools for:

- `.proofloop/`: local proof state, hook scripts, counters, tool-use logs, charts, and receipts.
- `proofloop.config.json`: the gate definition.
- `.github/workflows/`: the CI backstop.
- Any repo-specific additions in `protectedPaths`.

It also scans attempted edits for verifier-weakening patterns such as disabling gates, lowering
thresholds, or skipping evidence.

Honest boundary: the guard intercepts agent file-editing tools, not raw shell writes. Use
`proofloop ci install github` so CI re-runs the gate from a clean checkout.

## Configuration

```jsonc
{
  "app": "Vite",
  "workflow": "user signs up, uploads a CSV, sees the chart",
  "gate": {
    "checks": [
      { "name": "build", "command": "npm run build" },
      { "name": "tests", "command": "npm test" },
      { "name": "e2e", "command": "npx playwright test" }
    ]
  },
  "immutable": ["scripts/verify.mjs"],
  "protectedPaths": ["data/golden/"]
}
```

With no checks configured, `proofloop gate` falls back to `npm test` when `package.json` has a test
script. With neither, it reports `no_gate` with exit code 2. An unconfigured gate is never a pass.

## Commands

| Command | What it does |
|---|---|
| `proofloop init` | Detect the app and write a starter `proofloop.config.json`. |
| `proofloop init --agent auto --live` | Add agent docs, manifest, package aliases, workflows, and rubrics. |
| `proofloop doctor [--json]` | Report node/git/agent readiness, manifest/docs/scripts, Playwright/browser readiness, GitHub workflow, UI contracts, and fix commands. |
| `proofloop manifest [--json\|--dense]` | Print project status: stack, commands, proof gates, workflows, UI contracts, blockers. |
| `proofloop docs agents --dense` | Print compact agent workflow instructions. |
| `proofloop ui contract\|component <id>` | Discover stable `data-testid` and `data-proofloop` selectors. |
| `proofloop template --list` / `proofloop template <id> --write` | List or write starter proof-loop templates. |
| `proofloop workflow --list` | List local proof workflow files. |
| `proofloop resume [--json\|--dense]` | Read the latest gate receipt and print the next action. |
| `proofloop report latest [--json]` | Summarize the latest gate receipt. |
| `proofloop charts latest` | Write local JSON/SVG proof charts under `.proofloop/charts/`. |
| `proofloop mcp` | Start the optional read-only MCP server. |
| `proofloop gate [--check]` | Run configured checks or `npm test`; exit 0 pass, 1 fail, 2 unusable. |
| `proofloop hooks install\|uninstall\|status` | Install/remove/status Claude Code Stop, PreToolUse, and PostToolUse hooks. |
| `proofloop tooluse init\|verify` | Declare and verify expected-tool-use contracts. |
| `proofloop ci install github` | Install a GitHub Actions proof gate. |
| `proofloop prompt` | Print the canonical one-prompt kickoff. |
| `proofloop this-repo --live` | Run doctor/setup framing and print the local loop contract. |

## Expected-Tool-Use Contracts

If your agent takes real actions through tools such as Composio, MCP, or function calls, the gate can
assert it called required tools and never called forbidden ones:

```bash
npx proofloop tooluse init --template composio-email-triage
npx proofloop hooks install
# run your agent
npx proofloop tooluse verify --contract tooluse-contract.json
```

The verifier is fail-closed: a deny-list cannot be certified from an empty or missing log, and
server-pinned names mean `mcp__evil__X` cannot impersonate `mcp__composio__X`.

## Scope

This package is the portable core: gate, refuse-fake-done hooks, expected-tool-use contracts,
kickoff prompt, app/worker detection, agent-friendly setup, manifest/docs/script scaffolding,
UI-contract discovery, local proof charts, and a read-only MCP surface.

The package does not pretend to know your app's official benchmark or browser flow by default. You
make that real by putting deterministic checks in `proofloop.config.json`: build, tests, Playwright
user flows, live deployment smoke checks, official scorers, or your own verifier. Proof Loop then
supervises those checks and refuses fake done.

Proof Loop supervises; it does not replace your coding agent. You drive your agent (Claude Code,
Codex, Cursor, Windsurf, or another worker) and Proof Loop holds the gate. The optional MCP server is
for compact context surfaces, not a hidden autonomous worker fleet.

MIT (c) Homen Shum
