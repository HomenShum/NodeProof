# START HERE — the code in the order it runs

You have never seen this project. Read this page top to bottom and you will
have followed one real user action from the keystroke that starts it to the
file it writes and the test that proves it.

## The human situation, before any jargon

A developer is using a coding assistant — Claude Code, Codex, Cursor — to change
their app. The assistant edits files, runs nothing, and says **"Done! The tests
pass."** Sometimes that is true. Sometimes the assistant never ran the tests,
or ran them, saw red, and reported green anyway. The developer only finds out
later, from a user.

NodeProof (the npm package is called `proofloop`) sits between the assistant and
the word "done". It runs a command the developer chose — usually their test
suite — and if that command exits non-zero it **refuses to let the assistant
stop**, handing back the failure text so the assistant keeps working. The
refusal is written to a file on disk, so the next session, or a different
assistant, can read the last verdict without the previous chat transcript.

The technical name for the refusal point is a **Stop hook** (a script the
assistant's own harness runs when it tries to end a turn). The file it writes is
a **gate receipt**. Everything below is those two ideas in code.

> One sentence to take away on paper: *this repository is a command-line tool
> that runs your test command on behalf of a coding assistant and blocks the
> assistant from claiming success until that command exits zero, leaving the
> verdict in a JSON file anyone can read afterwards.*

## Run it first — 4 commands, no accounts, no keys

```bash
npm install          # 51 packages, no runtime dependencies
npm test             # its pretest runs `npm run build` (tsc) first
node dist/cli.js gate   # runs this repo's own gate against itself
node dist/cli.js help   # every command, one line each
```

`npm test` should print `Test Files 28 passed (28)` / `Tests 198 passed (198)`.
If it does, the walkthrough below describes code that works on your machine.
(Measured on a fresh clone of this commit; if your counts are higher, someone
has added tests since — that is fine, a lower count is not.)

There is a second, smaller surface: the landing page in `public/`, deployed as a
static site with `api/**` as serverless functions. It has its own walkthrough at
the end of this file, and its own browser proof:
`npm run proofloop:browser-proof`.

---

# Surface 1 — the proof loop (the primary flow)

Ten steps. Each names the file, the symbol, who calls it, and what it calls
next, so you can put this page down at any point and keep going in the editor.

## Step 1 — The command line enters the program

**File:** `src/cli.ts`
**Symbol:** `runCli`
**Called by:** `dist/cli.js` when run as a program (`package.json` → `bin.proofloop`), guarded by `require.main === module` at `src/cli.ts:1046` so importing the module never runs it
**Calls next:** one of ~28 command handlers; for this walkthrough, `runGateCli`

**Why this exists**
This is the only entry point for everything the tool does. There is no
framework, no router, and no plugin registry — one `switch` on the first
positional argument. If you want to know what a command does, you find its
`case` here and follow the import.

**Core code**
```ts
export function runCli(argv: string[]): number | Promise<number> {
  const { positional, options } = parseArgs(argv);
  const command = positional[0];
  const root = resolve(str(options.dir) ?? process.cwd());

  switch (command) {
    case "gate":
      return runGateCli({ root, check: options.check === true });
```

**Input** — `process.argv.slice(2)`, untrusted strings.
**Output** — a process exit code (`number`), or a `Promise<number>` for the
async commands.
**Failure behavior** — an unknown command prints usage to stderr and returns 2.
An exception anywhere below is caught at `src/cli.ts:1049` and also becomes
exit 2.
**Next** — Step 2, `runGateCli`.

## Step 2 — The primary user action: run the gate

**File:** `src/gate.ts`
**Symbol:** `runGateCli` (line 169), delegating to `runGate` (line 113)
**Called by:** `runCli` case `"gate"`; also `runProofloopAgentLoop` (Step 4)
**Calls next:** `readConfig` (Step 3), then `runCommand` per check

**Why this exists**
This is the whole product in one function. It decides *what counts as proof* and
then runs it. Two modes:

- default — actually run the checks;
- `--check` — read the **last** verdict off disk and exit on it, running
  nothing. The Stop hook uses this mode, because a hook that re-ran the test
  suite on every attempted stop would be unusable.

**Core code**
```ts
export function runGateCli(options: { root: string; check?: boolean } & GateCliIo): 0 | 1 | 2 {
  if (options.check) {
    const state = readGateState(root);
    if (!state) return 2;              // fail-closed: no verdict is not a pass
    return statusToExit(state.status);
  }
  const state = runGate(options);
  return statusToExit(state.status);
}
```

**Input** — a repo root, and a boolean for check-only mode.
**Output** — exit code `0` passed, `1` failed, `2` unusable (no gate configured,
or no verdict recorded yet). The mapping is one function, `statusToExit`
(`src/gate.ts:53`).
**Failure behavior** — a check whose command cannot even start records
`exitCode: null` and counts as a failure. Absent configuration is *not* silently
a pass: it is status `no_gate`, exit 2.
**Next** — Step 3, where the config file becomes typed data.

## Step 3 — Untrusted JSON becomes a typed config

**File:** `src/config.ts`
**Symbol:** `readConfig` (line 50) → `normalizeConfig` (line 63)
**Called by:** `runGate`, `installProofloopHooks`, `runInit`
**Calls next:** returns to `runGate`, which reads `config.gate.checks`

**Why this exists**
`proofloop.config.json` is written by a human or generated by `proofloop init`,
so by the time it is read it can be anything: missing, half-edited, a JSON array,
a file with a Windows BOM at the front. This is the single place where that
becomes a `ProofloopConfig` with the fields the rest of the code assumes. **No
other module parses that file.**

**Core code**
```ts
export function normalizeConfig(value: unknown): ProofloopConfig {
  const record = value && typeof value === "object" && !Array.isArray(value) ? ... : {};
  const checks: ProofloopGateCheck[] = [];
  for (const entry of rawChecks) {
    const command = typeof rec.command === "string" ? rec.command.trim() : "";
    if (!command) continue;           // a check with no command is dropped, not run
    checks.push({ name: ..., command });
  }
  return { app, workflow, gate: { checks }, immutable, protectedPaths };
}
```

**Input** — the parsed contents of `proofloop.config.json`, type `unknown`.
**Output** — a fully-populated `ProofloopConfig`; every field has a default, so
callers never branch on `undefined`.
**Failure behavior** — a **missing** file returns `undefined` (the caller then
falls back to `npm test`). **Unparseable** JSON throws, deliberately: running a
gate against a broken config would quietly prove nothing.
**Next** — Step 4, the loop that drives a coding agent with these results.

## Step 4 — The gate result enters agent orchestration

**File:** `src/agentLoop.ts`
**Symbol:** `runProofloopAgentLoop`
**Called by:** `runCli` case `"codex-loop"` → `runCodexLoopCommand` (`src/cli.ts:499`)
**Calls next:** `runGateCli` (Step 2), `buildAgentRepairPrompt`, `launchProofloopAgentAdapter` (`src/agentAdapters.ts`)

**Why this exists**
Everything above is one gate run. This is the loop: run the gate, and if it
failed, turn the failure into a prompt and hand it to the coding agent to fix,
up to `maxAttempts`. This is the only place in the repository that starts
another program that writes code.

**Core code**
```ts
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  lastExit = runGateCli({ root, ... });
  const verdict = verdictFromGate(runId, readGateState(root), lastExit);
  if (verdict.passed) return { runId, exitCode: 0, attempts: attempt, passed: true, runDir };

  const prompt = buildAgentRepairPrompt({ adapterId: agentId, verdict, ... });
  writeFileSync(repairPromptPath, prompt, "utf8");
  const runResult = options.dryRun ? { ...notLaunched } : launchProofloopAgentAdapter({ ... });
}
```

**Input** — repo root, an agent id (`codex`, `claude-code`, …), `maxAttempts`
(default 1), and `dryRun`.
**Output** — `{ runId, exitCode, attempts, passed, runDir }`, plus files under
`.proofloop/runs/<run-id>/`: one JSON per gate attempt and one markdown repair
prompt per failure.
**Failure behavior** — `--dry-run` writes the prompt and launches nothing. If
the agent cannot be launched (not installed, wrong command) the loop stops after
that attempt and returns the gate's exit code; it never spins.
**Next** — Step 5, the tools an agent is offered.

## Step 5 — Tools are registered for the agent to call

**File:** `src/mcp.ts`
**Symbol:** `TOOLS` (line 28) and `startMcpServer` (line 56)
**Called by:** `runCli` case `"mcp"`
**Calls next:** the same functions the CLI uses — `buildDoctorReport`, `buildResume`, `discoverUiContracts`, `listProofloopTemplates`

**Why this exists**
An assistant that can call this tool directly does not have to shell out and
parse text. The registry is a plain array of five read-only tools — no
framework, no decorators — spoken over stdin/stdout in JSON-RPC (the Model
Context Protocol, "MCP").

**Core code**
```ts
const TOOLS: McpTool[] = [
  { name: "proofloop_manifest",    description: "Return the compact Proof Loop project manifest.", inputSchema: ... },
  { name: "proofloop_doctor",      description: "Return setup/readiness checks and exact fix commands.", ... },
  { name: "proofloop_ui_contract", description: "Return stable data-testid/data-proofloop UI contracts.", ... },
  { name: "proofloop_resume",      description: "Return the next Proof Loop action from the latest gate receipt.", ... },
  { name: "proofloop_templates",   description: "List starter Proof Loop templates.", ... },
];
```

**Input** — JSON-RPC frames on stdin.
**Output** — JSON-RPC responses on stdout. **Every tool is read-only**; none of
them writes to the repository. That is the security boundary — an agent cannot
use this server to change files.
**Failure behavior** — an unknown method or malformed frame produces a JSON-RPC
error object; the server keeps reading. `runCli` returns the sentinel
`MCP_SERVER_RUNNING` (`src/cli.ts:99`) so the process is *not* exited while the
server is serving.
**Next** — Step 6, how tool calls are proven after the fact.

## Step 6 — Tool calls the agent claims are checked against a contract

**File:** `src/proofloopToolUse.ts`
**Symbol:** `verifyToolUseContract` (line 519)
**Called by:** `runToolUseVerify` (line 693) ← `runCli` case `"tooluse"`
**Calls next:** returns a `ToolUseVerdict`; the CLI turns it into an exit code

**Why this exists**
"I sent the email" is a claim. The `PostToolUse` logger installed by
`proofloop hooks install` appends every tool call the assistant made to
`.proofloop/tooluse/log.jsonl`; this function checks that log against a
declared contract — which tools were **required**, which were **forbidden**, and
which had to happen **before** others.

The rules that must never be relaxed are listed at the top of the file. Two
worth knowing before you touch it: an empty trace **fails** a required-tool
contract (it never passes vacuously), and a tool named `mcp__evil__SEND` cannot
satisfy a rule pinned to server `composio`.

**Core code**
```ts
export function verifyToolUseContract(
  contract: ToolUseContract,
  trace: ParsedToolUseTrace,
): ToolUseVerdict
```

**Input** — a parsed contract (JSON) and a parsed JSONL trace.
**Output** — `{ pass, violations[], ... }`; `runToolUseVerify` exits 0 pass,
1 violations, 2 unusable input.
**Failure behavior** — fail-closed everywhere: a missing or unparseable contract
or trace is exit 2, never a pass. Malformed trace lines above
`DEFAULT_MAX_MALFORMED_RATIO` (10%) fail verification, so corrupting the log
cannot buy a pass.
**Honest boundary, stated in the source** — this proves what *this machine's*
hooks observed. It is not server-side attestation, and a call made with `curl`
inside a shell tool is not captured.
**Next** — Step 7, where the verdict becomes a file.

## Step 7 — The verdict is written to disk

**File:** `src/gate.ts`
**Symbol:** `writeGateState` (line 73), called at the end of `runGate` (line 162)
**Called by:** `runGate`
**Calls next:** nothing — this is the leaf, and the only durable state the core
loop keeps

**Why this exists**
The receipt is the product. `.proofloop/gate-state.json` is what makes the
verdict survive the session: the Stop hook reads it, `proofloop resume` reads
it, and a human can open it. It is the answer to "did anyone actually run this?"

**Core code**
```ts
const state: GateState = {
  schema: "proofloop-gate-v1",
  status,                       // "passed" | "failed" | "no_gate"
  checks: results,              // name, command, pass, ms, exitCode
  ts: now().toISOString(),
  source,                       // "config-checks" | "npm-test-fallback" | "none"
};
writeGateState(root, state);
```

**Input** — the in-memory `GateState`.
**Output** — a pretty-printed JSON file at `.proofloop/gate-state.json`
(`GATE_STATE_RELATIVE_PATH`, line 21). The directory is created if missing.
**Failure behavior** — the write is unguarded on purpose: if the repository is
read-only, the gate crashes loudly rather than reporting a verdict it could not
persist.
**Other writers, for orientation** — `.proofloop/runs/<id>/` (Step 4),
`.proofloop/hooks/` (Step 9), `.proofloop/tooluse/log.jsonl` (Step 6). Nothing
in this repository writes outside `.proofloop/` except `proofloop init`
(`proofloop.config.json`), `proofloop ci install` (a workflow file), and
`proofloop hooks install` (the assistant's own settings file).
**Next** — Step 8, what the human sees.

## Step 8 — Progress and result reach the screen

**File:** `src/gate.ts`
**Symbol:** `formatGateState` (line 191); live output comes from `runCommand` (line 92)
**Called by:** `runGateCli`
**Calls next:** `console.log`

**Why this exists**
There is no streaming protocol here, and that is deliberate. The check command
is spawned with `stdio: "inherit"`, so your test runner's output goes straight to
your terminal in real time, unbuffered and uncaptured — you see exactly what you
would see running it yourself. Only the summary is formatted.

**Core code**
```ts
const result = spawnSync(command, {
  cwd: resolve(root), shell: true, encoding: "utf8",
  timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
  stdio: "inherit",
});
```

**Input** — the `GateState`, and the child process's own stdout/stderr.
**Output** — the child's output verbatim, then a summary block: status, receipt
path, timestamp, source, and one line per check with its duration.
**Failure behavior** — a check that hangs is killed at the 30-minute timeout and
recorded as a failure with `exitCode: null`.
**Next** — Step 9, what happens when the gate says no.

## Step 9 — Failure, refusal, and recovery

**File:** `src/proofloopHooks.ts`
**Symbol:** `stopGateScript` (line 504) — a generator that writes the standalone hook `.proofloop/hooks/stop-gate.mjs`; installed by `installProofloopHooks` (line 172)
**Called by:** `runCli` case `"hooks"` → `runHooksCommand` (`src/cli.ts:958`)
**Calls next:** at runtime the generated script calls `proofloop gate --check` (Step 2, check mode) or reads the receipt directly

**Why this exists**
This is the refusal. When the assistant tries to end its turn, its harness runs
this script; printing `{"decision":"block","reason":"..."}` sends the assistant
back to work with the failure text. The generated file imports nothing from this
project — plain Node — so it keeps working after the package is uninstalled.

Three safety properties, all visible in one screenful around line 653:

1. **Loop protection first.** A per-session counter caps how many times the hook
   may block (`DEFAULT_MAX_STOP_BLOCKS = 5`). At the cap it allows the stop and
   says plainly on stderr that the gate is still failing — it never traps a
   session forever.
2. **Fail open, loudly.** No gate configured, no verdict yet, or the check itself
   erroring all *allow* the stop with an explanation. A tool that bricks a repo
   that never opted in would be uninstalled by lunchtime.
3. **Fail closed where it counts.** `--check` with no receipt is exit 2, and the
   Stop hook treats an actual `failed` verdict as a block, every time.

**Core code**
```js
if (blocksSoFar >= maxStopBlocks) {
  console.error("proofloop stop-gate: the proof gate is STILL failing, but the block limit ("
    + maxStopBlocks + ") was reached for this session -- allowing the stop. ...");
  process.exit(0);
}
...
console.log(JSON.stringify({ decision: "block", reason }));
```

**Input** — the harness's JSON on stdin (`session_id`, `stop_hook_active`, …).
**Output** — exit 0 with no stdout (stop allowed) or exit 0 with a `block`
decision (stop refused).
**Recovery** — a new session starts cold with no transcript. `proofloop resume
--dense` (`buildResume`, `src/project.ts:518`) reads the same receipt and prints
the next action, which is how a different assistant picks the work up.
**Next** — Step 10, the tests that hold all of this in place.

## Step 10 — The tests that prove the flow

| What it proves | File |
|---|---|
| Gate passes/fails/`no_gate` and persists each verdict; `--check` re-reads without re-running | `tests/gate.test.ts:88-146` |
| Config normalization, including a UTF-8 BOM written by PowerShell | `tests/gate.test.ts:77` |
| Hook install merges into existing settings without clobbering, and uninstall is exact | `tests/proofloopHooks.test.ts` |
| Tool-use contracts: empty trace fails, namespace spoofing fails, order rules | `tests/proofloopToolUse.test.ts` with fixtures in `tests/fixtures/tooluse/` |
| The landing page's two journeys drive in a real Chromium | `tests/browserProof.test.ts` + `scripts/browser-proof.mjs` |
| The `api/**` handlers refuse an unowned domain with a usable receipt | `tests/hostedApi.test.ts` |

Run all of them with `npm test`. Run one file with
`npx vitest run tests/gate.test.ts`.

---

# Surface 2 — the landing page and its serverless API

Same format, four steps. This is the flow a stranger meets at the deployed URL:
they paste a URL or a repo and either get commands to copy, or a refusal.

## Step W1 — The page and its one input

**File:** `public/index.html`, script `public/app.js`
**Symbol:** the IIFE at `public/app.js:1`; handlers wired at lines 138-141
**Called by:** the browser, on load
**Calls next:** `submitTarget` on click or Enter

**Why this exists** — the whole page is one text field and one button. There is
no framework and no build step for it: `public/` is deployed as-is.
**Input** — whatever the visitor types. `normalizeTarget` (line 23) accepts
`owner/repo`, `github.com/...`, or a full URL.
**Output** — either a copyable command block, or a request to the API.
**Failure behavior** — an unparseable target sets a `blocked` status locally and
never reaches the network.

## Step W2 — GitHub repos never reach the automation path

**File:** `public/app.js`
**Symbol:** `githubRepo` (line 32) → `githubCommand` (line 44)
**Called by:** `submitTarget` (line 89)
**Calls next:** nothing — it returns before any `fetch`

**Why this exists** — pointing a browser robot at `github.com` would be both
useless and rude. A GitHub target is answered entirely in the browser with the
four commands to run locally. This early return is the reason the browser proof
asserts that github.com never appears in a request to `/api/hosted/submit`.

## Step W3 — A live URL crosses the trust boundary

**File:** `api/hosted/submit.js`, helpers in `api/hosted/_shared.js`
**Symbol:** the exported `handler`; the decision is `verifiedHostAllowlist` (`api/hosted/_shared.js:72`)
**Called by:** Vercel, routing `POST /api/hosted/submit`
**Calls next:** `buildHostedRunBundle` / `validateHostedRunRequest`, imported from the compiled `dist/hosted.js` (see `docs/codebase/ARCHITECTURE.md` on why the API layer imports `dist/`)

**Why this exists** — this is where "may we point automation at this host?" is
answered, and it is answered on the **server**, from evidence: a
`.well-known` file or a DNS TXT record proving control of the domain. The
browser never gets a vote.

**Input** — the JSON body the page posted.
**Output** — `202` queued, `400` blocked with the reasons and the exact token to
publish, or `503` if dispatch failed. There is no `200` path.
**Failure behavior** — unverified domains are refused with a receipt naming the
host, the method, the token, and the blockers.

## Step W4 — The refusal is rendered

**File:** `public/app.js`
**Symbol:** `setStatus` (line 10), called from `submitTarget` (line 127)
**Called by:** `submitTarget`
**Calls next:** nothing

**Known defect, deliberately left open.** Line 127 passes `data.status` — the
machine enum `"blocked"` — straight through as the user-facing headline, so the
page's entire message on the main failure path is the single lowercase word
**blocked**, above a JSON dump. This is defect **D1** in
`promotion/PROMOTION_LOG.md`, with defect **D2** (the status element has no
`role="status"`/`aria-live`, so a screen reader announces nothing) directly
underneath it. Both are product fixes belonging to the promotion loop, not to
this structural pass; `docs/codebase/CONCERNS.md` explains why they were not
folded in here.

---

## Where you would add one adjacent capability

- **A new gate check type** (say, "the build must also succeed"): nothing to
  change — add it to `gate.checks` in `proofloop.config.json`. That is the
  extension point, and it is data, not code.
- **A new CLI command:** add a `case` in `src/cli.ts`, a module beside it in
  `src/`, and a test in `tests/`. Follow `src/gate.ts` — small module, exported
  pure functions, one `run*Cli` wrapper returning an exit code.
- **A new MCP tool:** add an entry to `TOOLS` in `src/mcp.ts` and a branch in
  its call handler. Keep it read-only; that property is the boundary.
- **A new hook host** (an assistant other than Claude Code or Codex): extend
  `ProofloopHookWorker` (`src/proofloopHooks.ts:114`) and the settings-path
  resolver at line 1044. The generated scripts themselves are host-agnostic.
