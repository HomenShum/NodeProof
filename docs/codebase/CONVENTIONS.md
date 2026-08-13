# Conventions

Patterns this codebase actually follows. Each one is checkable against the
source; where a convention has exceptions, they are named.

## Naming

- **Commands are verbs the user types.** `gate`, `init`, `doctor`, `resume`.
  The module is named after the command (`gate.ts`, `init.ts`, `doctor.ts`), and
  the CLI wrapper is `run<Command>Cli`.
- **`proofloop`/`Proofloop` prefixes appear on exported symbols that leave the
  module** (`runProofloopRunner`, `PROOFLOOP_AGENT_ADAPTER_IDS`) because
  `src/index.ts` re-exports everything into one flat namespace with `export *`.
  Local helpers are unprefixed.
- **Receipt schemas are versioned strings**, and they are literal fields on the
  object: `"proofloop-gate-v1"`, `"proofloop-hosted-run-v1"`,
  `"proofloop-browser-proof-v1"`. When the shape changes, bump the string.

## Function shape

Every command module follows the same three-part split, visible in the smallest
example (`src/gate.ts`, 201 lines):

```ts
export function runGate(options): GateState        // pure-ish core, returns data
export function formatGateState(state, ...): string // data -> text, no IO
export function runGateCli(options): 0 | 1 | 2      // IO + exit code
```

The reason is testability: `tests/gate.test.ts` calls the first two and asserts
on values, never on console output.

**Console output belongs to the `run*Cli` wrapper.** Core functions accept
optional `log`/`logError` injectors (`GateCliIo`) rather than calling `console`
directly, which is how tests capture output when they need to.

## Exit codes

The same three everywhere, mapped in one place (`statusToExit`, `src/gate.ts:53`):

| Code | Meaning |
|---|---|
| 0 | passed |
| 1 | failed — the thing being checked is wrong |
| 2 | unusable — bad arguments, missing file, nothing configured |

**2 is not a synonym for 1.** "I could not check" and "I checked and it failed"
are different facts, and callers branch on the difference.

## Options

Options objects, never positional booleans. Optional fields are spread
conditionally so an absent flag stays absent rather than becoming `undefined`:

```ts
...(str(options.goal) !== undefined ? { goal: str(options.goal)! } : {}),
```

That pattern is everywhere in `src/cli.ts`. It exists because
`exactOptionalPropertyTypes`-style strictness treats `{ goal: undefined }` and
`{}` as different, and defaults live in the callee.

## Error handling

- **Fail closed on evidence, fail open on infrastructure.** A missing verdict is
  exit 2 (closed). A hook that cannot reach its gate allows the stop and says so
  on stderr (open). The rule: never let an infrastructure problem *silently*
  become a pass, and never let it brick a user's repository either.
- **Throw for programmer/config errors, return a result for user errors.** An
  unparseable config throws; a URL that fails validation returns
  `{ ok: false, blockers: [...] }`.
- **Every catch says which command it came from**:
  `` console.error(`proofloop solo attest: ${message}`) ``. A bare error message
  in a terminal running four tools is a support ticket.

## Files and paths

- **`node:` prefixed imports** everywhere: `node:fs`, `node:path`.
- **Everything is `resolve(root)`-relative**, and `root` comes from `--dir` or
  `process.cwd()`. No module reads `process.cwd()` on its own except the CLI.
- **Repo-relative paths in data use forward slashes**, split on write:
  `join(resolve(root), ...GATE_STATE_RELATIVE_PATH.split("/"))`. Windows is a
  first-class platform here — there is a test for a PowerShell-written UTF-8 BOM
  (`tests/gate.test.ts:77`).
- **Directories are created on write**, never assumed: `mkdirSync(dirname(path),
  { recursive: true })`.

## Comments

The convention is unusual and worth keeping: **a comment explains a decision or
a hazard, never the syntax.** The best examples are the file headers of
`src/proofloopHooks.ts` and `src/proofloopToolUse.ts`, which list the properties
that must not regress, and the comment above `DEFAULT_GATE_COMMAND`
(`src/proofloopHooks.ts:60`), which explains why the default is *not* the
obvious choice.

If you add a module, add a header saying who uses it and what would go wrong
without it. Eight modules were missing one before this pass; they have one now.

## Tests

- One file per module, `tests/<module>.test.ts`.
- **Real files, temporary directories.** Tests `mkdtempSync` a directory, write
  actual JSON, run the real function, and read the result back. There is no
  filesystem mock.
- Test names are sentences about behaviour: *"falls back to `npm test` when no
  checks configured but package.json has a test script"*.
- **Never weaken an assertion to make a change pass.** If a test blocks you,
  either the change is wrong or the test's expectation needs a justification in
  the commit message that traces to a spec or a measurement.
