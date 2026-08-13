# Structure

Every top-level directory, and every module in `src/`, with the one thing it is
for. If you are looking for where something happens, this page and
`docs/START_HERE.md` should get you to the file in one hop.

## Top level

| Path | What it is | Generated? |
|---|---|---|
| `src/` | the TypeScript source — the only place to edit product code | no |
| `dist/` | the compiled output of `src/`, **committed** | **yes — `npm run build`** |
| `api/` | Vercel serverless functions, hand-written CommonJS JavaScript | no |
| `public/` | the landing page: three files, deployed as-is | no |
| `tests/` | vitest suites, one per module, plus fixtures | no |
| `scripts/` | Node scripts run by npm targets, not part of the package | no |
| `docs/` | this packet, plus `docs/agent-os/` (see below) | no |
| `promotion/` | the product loop's own record: goal, journeys, defect ledger, evidence | no |
| `schemas/` | the one JSON Schema the interop lane pins against | no |
| `templates/` | the GitHub Actions gate workflow written into a user's repo | no |
| `.tours/` | CodeTour walkthroughs, validated by `tests/walkthrough.test.ts` | no |
| `.github/workflows/` | CI, the hosted worker, and the platform conformance check | no |

**`dist/` is committed on purpose.** It is not a mistake and it is not stale
build output left behind — `api/hosted/_shared.js` and `scripts/hosted-worker.mjs`
`require()` it at runtime. `docs/codebase/ARCHITECTURE.md` explains the seam and
`docs/codebase/CONCERNS.md` records the cost. **Never edit a file in `dist/`;
edit `src/` and run `npm run build`.**

**`docs/agent-os/` is a product asset, not documentation of this codebase.** It
is a 22-file reference library that ships with the package and is listed as a
protected path in `proofloop.config.json`. Do not fold it into this packet.

## `src/` — 30 modules

Read them in this order if you are new; the first four are the whole product.

| Module | Lines | What it is for |
|---|---:|---|
| `cli.ts` | 1053 | argv → one of ~28 commands. The only entry point. |
| `gate.ts` | 201 | **run the checks, write the verdict.** The product in one file. |
| `config.ts` | 92 | the only reader of `proofloop.config.json`; untrusted JSON → typed |
| `proofloopHooks.ts` | 1079 | install/uninstall the Stop, PreToolUse and PostToolUse hooks; generates the standalone hook scripts |
| `agentLoop.ts` | 138 | gate → repair prompt → launch the coding agent, bounded by `maxAttempts` |
| `agentAdapters.ts` | 340 | one thin adapter per agent (Codex, Claude Code, Cursor, Windsurf, Devin, generic) |
| `codexRelaunch.ts` | 137 | the relaunch packet and reprompt files for Codex specifically |
| `proofloopToolUse.ts` | 756 | expected-tool-use contracts: required / forbidden / ordered tool calls, verified against the captured log |
| `scaffoldConstants.ts` | 92 | default protected paths and the verifier-weakening patterns the PreToolUse guard blocks |
| `mcp.ts` | 184 | the read-only MCP server: five tools over JSON-RPC on stdio |
| `init.ts` | 83 | `proofloop init` — detect the app, write a starter config, non-destructive |
| `detect.ts` | 133 | what kind of app is this, and which agent CLIs are on PATH |
| `doctor.ts` | 198 | readiness report with exact fix commands; the zero-key `npm run demo` |
| `project.ts` | 735 | the paperwork around a repo: manifest, agent docs, templates, UI contracts, report, **resume** |
| `prompt.ts` | 61 | the canonical one-prompt kickoff text |
| `proofloopCi.ts` | 83 | write the GitHub Actions gate workflow into a user's repo |
| `runner.ts` | 892 | durable append-only task runner: lock, ledger, resume, budget |
| `layeredPlan.ts` | 207 | a two-layer certification variant of a runner plan |
| `targetPlan.ts` | 751 | given a repo or URL, recommend which proof families to run |
| `contextReport.ts` | 144 | the markdown handoff report an agent reads to start cold |
| `maturity.ts` | 713 | score the repo 0–5 on agent-era readiness from file evidence |
| `productivity.ts` | 626 | wage-equivalent value of a proven run, discounted by evidence quality |
| `hosted.ts` | 640 | the hosted lane: request bundles, domain-permission rules, worker plans |
| `receipts.ts` | 207 | verify receipts produced by *other* systems (`nodeagent-ingestion`) |
| `soloInterop.ts` | 1405 | validate a work envelope handed over by the Solo Founder toolchain |
| `soloSetup.ts` | 896 | install that toolchain's skill files into a target repo |
| `soloTrust.ts` | 214 | sign and verify trust receipts (Ed25519 via `node:crypto`) |
| `providerSetup.ts` | 242 | write setup receipts for optional external providers |
| `thisRepo.ts` | 117 | `proofloop this-repo` — point the whole flow at the current repository |
| `index.ts` | 34 | the published API surface: `export *` of everything above |

## Where state lives

Everything the tool writes goes under `.proofloop/` in the target repository,
which is gitignored here:

| Path | Written by | Read by |
|---|---|---|
| `.proofloop/gate-state.json` | `gate.ts` | the Stop hook, `resume`, `productivity` |
| `.proofloop/hooks/` | `proofloopHooks.ts` | the agent's harness |
| `.proofloop/tooluse/log.jsonl` | the generated PostToolUse hook | `proofloopToolUse.ts` |
| `.proofloop/runs/<id>/` | `agentLoop.ts` | `codex reprompt`, humans |
| `.proofloop/runner/runs/<id>/` | `runner.ts` | `runner status\|report\|resume` |
| `.proofloop/interop/solo/` | `soloInterop.ts` | `solo status\|gate` |

Three files are written **outside** `.proofloop/`, all by explicit commands:
`proofloop.config.json` (`init`), `.github/workflows/*.yml` (`ci install`), and
the agent's own settings file (`hooks install`).

## Tests

One suite per module, named after it: `tests/gate.test.ts`,
`tests/proofloopHooks.test.ts`, and so on. Two are not module-shaped —
`tests/browserProof.test.ts` (the landing page in a real Chromium) and
`tests/walkthrough.test.ts` (this documentation still matches the code).
