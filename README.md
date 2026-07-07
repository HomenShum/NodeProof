# Proof Loop

**Bring any coding agent. Proof Loop makes it prove the app works.**

Coding agents write code and say "done." Proof Loop is the supervisor that decides whether done is
true: it runs a gate against your app, refuses false completion, captures which tools your agent
actually called, and keeps proof state the agent cannot quietly weaken. One prompt starts the loop;
the gate decides when it is actually done.

Zero runtime dependencies. Node >= 20. Works on any repo.

## ProofLoop Live

`proofloop.live` is the managed-service intake for teams that want Proof Loop run against their app
without first becoming benchmark-infra experts: send a live URL or a codebase target, choose the
benchmark or proxy-task families, set a budget cap, and receive proof artifacts from the runner.

The public site is intentionally static. It creates a scoped run request and keeps the same honesty
boundary as the CLI: product-path proof, proxy benchmark proof, and official scorer output must be
labeled separately. It does not collect tokens or repository credentials in the browser.

The portable CLI now includes the local intake layer that service uses first:

```bash
npx proofloop target --url https://your-app.example --write-runner-plan
npx proofloop target --url https://your-app.example --write-browser-smoke --write-runner-plan
npx proofloop target --dir . --write-runner-plan
```

`target` fetches the live URL or scans the codebase, recommends benchmark families with evidence,
detects any already-configured benchmark/browser scripts, writes
`.proofloop/target/latest-target-plan.json`, and can write a runnable
`.proofloop/runner/target.plan.json`. It also writes a dated, LangChain-docs-style context page at
`.proofloop/reports/latest.md` for the next human or coding agent to read before continuing the run.
It does not invent official scores; missing adapters and official scorer paths are recorded as
blockers.

When `--write-browser-smoke` is provided with `--url` in a repo with `package.json`, Proof Loop
writes `proofloop/browser/live-smoke.spec.ts` and a `proofloop:live-smoke` package script. That turns
basic live URL rendering/clickability into a runnable Playwright task while keeping deeper app flows
and official benchmark scorers explicit.

## Quickstart

```bash
npx proofloop init --agent auto --live  # config + manifest + agent docs + scripts + live scaffold
npx proofloop doctor --json             # setup checks and fix commands
npx proofloop manifest --dense          # compact repo status for agents
npx proofloop ui contract --dense       # stable selectors/actions/assertions
npx proofloop target --write-runner-plan # benchmark plan + context report + runner discovery
npx proofloop prompt                    # kickoff prompt to paste into your coding agent
npx proofloop this-repo --goal "proofloop my latest updates" --write-runner-plan
npx proofloop runner run --plan proofloop.runner.json --budget-usd 100
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

ProofLoop also ships an Agent OS markdown pack under `docs/agent-os/`. It adapts the Room OS
human-world-model idea into deterministic proof supervision: goals are contracts, the world model is
the current target plus receipts/blockers, memory is mined from prior failures, and workers do not
grade their own work.

For a non-technical kickoff, tell Claude/Codex: "proofloop my latest repo" or
"proofloop my latest updates." The agent-facing command is:

```bash
npx proofloop this-repo --goal "proofloop my latest updates" --write-runner-plan
```

That writes `.proofloop/runner/latest-updates.plan.json` in two layers:

- Capability checks: headless build/test/typecheck/lint/gate tasks.
- Browser certification checks: discovered e2e/browser/Playwright/Cypress tasks.

Watch/dev/preview/server scripts are intentionally skipped; long-running services should be started
by your app-specific harness, not as proof tasks that never terminate.

Browser verification is not forced through every capability task. Use the local durable runner when
you want the CLI to execute the plan with append-only state, budget control, and resume:

```bash
npx proofloop this-repo --goal "proofloop my latest updates" --write-runner-plan --run --budget-usd 100
```

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
| `proofloop target [--url <url>] [--write-runner-plan] [--write-browser-smoke] [--json]` | Recommend benchmark families from a URL/codebase, detect or scaffold configured adapters, and write target/runner plan receipts plus `.proofloop/reports/latest.md`. |
| `proofloop docs agents --dense` | Print compact agent workflow instructions. |
| `proofloop ui contract\|component <id>` | Discover stable `data-testid` and `data-proofloop` selectors. |
| `proofloop template --list` / `proofloop template <id> --write` | List or write starter proof-loop templates. |
| `proofloop workflow --list` | List local proof workflow files. |
| `proofloop resume [--json\|--dense]` | Read the latest gate receipt and print the next action. |
| `proofloop report latest [--json]` | Summarize the latest gate receipt. |
| `proofloop charts latest` | Write local JSON/SVG proof charts under `.proofloop/charts/`. |
| `proofloop receipt verify --file <path>` | Verify app-produced proof receipts such as NodeAgent ingestion receipts. |
| `proofloop runner run --plan <file> --budget-usd 100` | Run an append-only, budgeted task plan under `.proofloop/runner/runs/<runId>/`. |
| `proofloop runner resume --run-id latest --clear-stale-lock` | Resume a runner after a crash; stale `running` tasks are requeued after explicit stale-lock clearance. |
| `proofloop runner status --run-id latest [--json]` | Inspect durable runner state and ledger paths. |
| `proofloop runner report --run-id latest [--json]` | Print the runner honesty report with per-family/per-model pass rate and estimated cost/pass. |
| `proofloop mcp` | Start the optional read-only MCP server. |
| `proofloop gate [--check]` | Run configured checks or `npm test`; exit 0 pass, 1 fail, 2 unusable. |
| `proofloop hooks install\|uninstall\|status` | Install/remove/status Claude Code Stop, PreToolUse, and PostToolUse hooks. |
| `proofloop tooluse init\|verify` | Declare and verify expected-tool-use contracts. |
| `proofloop ci install github` | Install a GitHub Actions proof gate. |
| `proofloop prompt` | Print the canonical one-prompt kickoff. |
| `proofloop this-repo --live` | Run doctor/setup framing and print the local loop contract. |
| `proofloop this-repo --write-runner-plan [--run]` | Generate and optionally execute a two-layer durable runner plan for latest repo/latest updates. |

Minimal runner plan:

```json
{
  "schema": "proofloop-runner-plan-v1",
  "tasks": [
    { "id": "unit-tests", "command": "npm test", "estimatedCostUsd": 0 }
  ]
}
```

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

## App-Produced Receipts

Proof Loop can gate receipts emitted by app-specific harnesses without owning their internals. For
NodeRoom's two-pool document ingestion runner:

```bash
npm run nodeagent:ingestion:smoke
npx proofloop receipt verify \
  --file docs/eval/nodeagent-ingestion-orchestrator.json \
  --kind nodeagent-ingestion \
  --min-documents 1 \
  --min-memory-objects 1
```

The verifier checks the receipt type/version, `ok: true`, document-pool to memory-pool stage order,
created document and memory-object counts, proof hashes/keys, zero source/chunk failures, and positive
batch/concurrency config. Failed receipts exit 1, while malformed CLI usage exits 2.

## Scope

This package is the portable core: gate, refuse-fake-done hooks, expected-tool-use contracts,
kickoff prompt, app/worker detection, agent-friendly setup, manifest/docs/script scaffolding,
UI-contract discovery, local proof charts, and a read-only MCP surface.
It also includes a generic durable runner for long jobs: append-only ledger,
atomic state writes, single-flight locks, budget kill-switch (exit 3), stale-running
resume, torn-tail ledger repair, explicit `--clear-stale-lock` recovery, and secret redaction.
Bring your app-specific benchmark commands in a
`proofloop-runner-plan-v1` JSON file; the package supervises execution without
claiming benchmark semantics for you.

`proofloop this-repo --write-runner-plan` generates a generic two-layer plan from the current repo:
headless capability checks first, then browser/UI certification checks if the repo exposes them.
This is the external-orchestrator path for "proofloop my latest repo" style usage. The runner can
execute that plan locally, but official benchmark meaning still belongs to your app-specific
scorers and receipts.

`proofloop target` is the next layer for "give ProofLoop a URL or codebase" usage. It matches known
families such as BankerToolBench/accounting, SpreadsheetBench, FinAuditing/FinMR, Finch,
WorkstreamBench, underwriting, research copilot, NodeAgent memory ingestion, and live-browser smoke
tests. It writes evidence and blockers so an agent or managed runner knows what adapter/scorer work
is still missing before it claims coverage.

The package does not pretend to know your app's official benchmark or browser flow by default. You
make that real by putting deterministic checks in `proofloop.config.json`: build, tests, Playwright
user flows, live deployment smoke checks, official scorers, or your own verifier. Proof Loop then
supervises those checks and refuses fake done.

Proof Loop supervises; it does not replace your coding agent. You drive your agent (Claude Code,
Codex, Cursor, Windsurf, or another worker) and Proof Loop holds the gate. The optional MCP server is
for compact context surfaces, not a hidden autonomous worker fleet; `proofloop runner` is the local
outer loop for commands you explicitly put in a plan.

MIT (c) Homen Shum
