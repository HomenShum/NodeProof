# Proof Loop

**Bring any coding agent. Proof Loop makes it prove the app works.**

Coding agents write code and say "done." Proof Loop is the supervisor that decides whether *done*
is true: it runs a gate against your app, refuses false completion, captures which tools your agent
actually called, and keeps a regression the agent can't quietly weaken. One prompt starts the loop —
**the gate decides when it's actually done.**

Zero runtime dependencies. Node ≥ 20. Works on any repo.

## Quickstart (hackathon-speed)

```bash
npx proofloop init      # detect your app, write proofloop.config.json
npx proofloop doctor    # check node/git/coding-agent readiness
npx proofloop prompt    # the kickoff prompt to paste into your coding agent
npx proofloop gate      # run your configured checks -> pass/fail + .proofloop/gate-state.json
```

Then make "done" honest for a Claude Code session:

```bash
npx proofloop hooks install
```

This installs a **Stop hook** that refuses to let the agent stop while the gate is failing (with
loop protection so it nudges, never loops forever), and a **PreToolUse guard** that blocks edits to
your proof state and verifier files. Uninstall with `proofloop hooks uninstall`.

**Define the gate before installing hooks.** Once hooks are installed, `proofloop.config.json` is
itself a protected path — the gate definition is not the agent's to move.

### How the Stop gate decides

- **Default (check-only):** the hook reads the persisted verdict at `.proofloop/gate-state.json` —
  no subprocess, no network, deterministic. `passed` → stop allowed; `failed` → stop blocked with
  the failing checks as the reason; no verdict yet / `no_gate` → stop **allowed** with an honest
  note (the hook never bricks a fresh repo). Re-run `proofloop gate` to refresh the verdict; a
  cached PASS is only as fresh as the last gate run.
- **Command mode (opt-in):** `proofloop hooks install --gate-command "<cmd>"` spawns your command
  on every stop attempt and blocks unless it exits 0.
- **Loop protection:** a per-session block counter caps how many times the hook may refuse a stop
  (default 5, `--max-stop-blocks <n>`); at the cap it allows the stop with a stderr warning that the
  goal is NOT proven done.

### Protected paths (the goalpost layer)

The PreToolUse guard refuses agent edits (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`, exit 2) to:

- **`.proofloop/`** — all local proof state: the gate verdict the Stop hook trusts
  (one forged write to `.proofloop/gate-state.json` would fake a PASS), the hook scripts and block
  counters, the tool-use capture log, regression history.
- **`proofloop.config.json`** — the gate definition (checks, immutable list, protected paths).
- **`.github/workflows/`** — the CI backstop that re-verifies the gate.
- **your additions** — `protectedPaths: []` in `proofloop.config.json` (golden data, verify
  scripts, fixtures…). Defaults are not removable.

Edits under protected/guarded paths are additionally content-scanned for verifier-weakening
patterns (lowering `minScore`, "skip evidence", "disable gate", …) and refused on match.

> **Known bypass (honest):** the guard intercepts the agent's file-editing *tools*, not raw shell —
> a `Bash`-issued write is not blocked. That is what `proofloop ci install github` is for: CI
> re-runs the gate from a clean checkout, so a doctored local verdict doesn't survive a PR.

## Configuration (`proofloop.config.json`)

```jsonc
{
  "app": "Vite",                      // detected by `proofloop init`
  "workflow": "user signs up, uploads a CSV, sees the chart", // one-line intended workflow
  "gate": {
    "checks": [                        // each must exit 0 to count as proof
      { "name": "build", "command": "npm run build" },
      { "name": "tests", "command": "npm test" },
      { "name": "e2e",   "command": "npx playwright test" }
    ]
  },
  "immutable": ["scripts/verify.mjs"],   // repo-specific files the agent may never edit
  "protectedPaths": ["data/golden/"]     // ADDITIONS to the default protected set above
}
```

With no checks configured, `proofloop gate` falls back to `npm test` when `package.json` has a test
script; with neither, it reports `no_gate` (exit 2) — an unconfigured gate is never a pass.

## Commands

| Command | What it does |
|---|---|
| `proofloop init` | Detect the app (Next/Vite/React/Python/generic) and write a starter `proofloop.config.json`. |
| `proofloop doctor` | Report node version, git, which coding-agent workers (claude, codex) are on PATH, and whether hooks/config exist. |
| `proofloop gate [--check]` | Run `gate.checks` (each a shell command; pass ⇔ exit 0) or your `npm test`. Writes `.proofloop/gate-state.json`. `--check` reads the last verdict without re-running. Exit 0 pass / 1 fail / 2 unusable. |
| `proofloop hooks install\|uninstall\|status` | Install/remove the Stop + PreToolUse + PostToolUse hooks for Claude Code (deep-merged into `.claude/settings.json`, never clobbering your own hooks). |
| `proofloop tooluse init\|verify` | Declare an **expected-tool-use contract** (must-call / must-not-call / order / params) and verify the captured tool log against it. Ships a `composio-email-triage` template. |
| `proofloop ci install github` | Install a `proofloop-gate` GitHub Actions workflow so CI catches a lying local run. |
| `proofloop prompt` | Print the canonical one-prompt kickoff. |
| `proofloop this-repo` | The hackathon one-shot: doctor + ensure config + print the kickoff prompt. |

## Expected-tool-use contracts (for tool-calling agents, e.g. Composio)

If your agent takes real actions through tools — Composio, MCP, function calls — the gate can assert
it called the tools it was supposed to and **never** called forbidden ones:

```bash
npx proofloop tooluse init --template composio-email-triage   # writes a starter contract
npx proofloop hooks install                                    # captures tool calls to .proofloop/tooluse/log.jsonl
# ... run your agent ...
npx proofloop tooluse verify --contract tooluse-contract.json  # pass/fail against the contract
```

The verifier is **fail-closed**: a deny-list ("never call `GITHUB_*`") cannot be certified from an
empty or missing log, and server-pinned names mean `mcp__evil__X` can't impersonate
`mcp__composio__X`.

> **Honest boundary.** This is **local, session-side capture** — it proves what *this* worker's tool
> hooks saw. It is not server-side attestation from your tool provider, and tool calls issued outside
> the agent's hooks (e.g. raw `curl` in a Bash step) are not captured. CI re-verification of a
> committed trace is the backstop.

## Scope (honest)

This package is the **portable core**: gate, refuse-fake-done hooks, expected-tool-use contracts,
kickoff prompt, app/worker detection. The full **live-browser certification** — Playwright
user-workflow proof, visual judges, code-graph blast-radius localization, chart packs — lives in the
NodeRoom reference implementation and is on the roadmap for this package. The portable
**benchmark-driven agent-development skills** are at
[github.com/HomenShum/solo-founder-agent-builder](https://github.com/HomenShum/solo-founder-agent-builder).

Proof Loop **supervises**; it does not replace your coding agent. In v0.1 you drive your agent (Claude
Code, Codex, …) and Proof Loop holds the gate — it does not auto-spawn a worker fleet.

## Doctrine

Proof Loop is self-improving but never self-grading: the gate is external to every worker, and the
guard blocks edits that would weaken the verifier or doctor the proof state. See the NodeRoom
`anti-reward-hacking-doctrine` for the full treatment.

MIT © Homen Shum
