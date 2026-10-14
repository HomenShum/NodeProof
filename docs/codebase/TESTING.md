# Testing

## How to run

```bash
npm test                          # pretest builds (tsc), then vitest run
npm run check                    # tests, then audit runtime AND development dependencies
npx vitest run tests/gate.test.ts # one file
npm run test:watch                # watch mode
npm run proofloop:browser-proof   # the real-Chromium proof of the landing page
npm run proofloop:web-audit       # Lighthouse + axe against the same page (needs network)
npm run proofloop:wig-review      # Web Interface Guidelines measurements, same page
node dist/cli.js gate             # the tool's own gate: npm run build && npm test
```

The 2026-10-14 repair-loop baseline has **35 files, 364 tests, 0 failed**.
The developer-tool security update reruns this unchanged suite with Vitest
4.1.11. Read the current run's count: documentation anchors generate cases,
so adding documentation can change it.

`npm test` builds first — `pretest` runs `npm run build` — because two suites
spawn the compiled `dist/cli.js` rather than importing TypeScript.

`npm run check` and CI audit the full dependency graph because coding agents
and developers execute the test tools too. Previously, `--omit=dev` excluded
all installed packages in this zero-runtime-dependency project, while CI's
install printed known vulnerabilities without failing. An advisory or an
unavailable audit service now fails the audit step; it is not a clean result.

The patched Vitest 4 line retains the existing Node 20 test environment.
Vitest 5 modernization remains separate: it requires newer development Node
and type peers, and must preserve explicit Node 20 consumer proof rather than
silently raising the CLI's `>=20` runtime floor.

Chromium is a separate install for the browser proof:
`npx playwright install chromium`.

## What the suites cover

| Suite | Proves |
|---|---|
| `gate.test.ts` | app detection, `init` non-destructiveness, all four gate outcomes, `--check` reading without re-running, PowerShell BOM configs |
| `proofloopHooks.test.ts` | hooks merge into existing settings without clobbering, uninstall removes exactly ours, the generated scripts' content |
| `protectedPaths.test.ts` | the PreToolUse guard blocks protected and immutable paths, and cannot be widened away by config |
| `proofloopToolUse.test.ts` | required / forbidden / order rules, empty-trace fail-closed, MCP namespace spoofing, malformed-line ratio |
| `runner.test.ts` | lock acquisition, torn-ledger repair, resume, budget blocking |
| `hosted.test.ts`, `hostedApi.test.ts` | request bundles and domain-permission decisions; the real `api/**` handlers over a fake req/res |
| `githubAuth.test.ts` | OAuth state cookie, unconfigured-deployment redirect |
| `soloInterop.test.ts`, `soloSetup.test.ts`, `soloTrust.test.ts` | envelope validation, skill installation, Ed25519 sign/verify |
| `maturity.test.ts`, `productivity.test.ts`, `targetPlan.test.ts`, `layeredPlan.test.ts` | the scoring and planning outputs |
| `site.test.ts` | the landing page's copy, its test ids, and that GitHub targets never reach the automation API |
| `browserProof.test.ts` | the committed browser receipt exists, passes, and its producer is runnable |
| `walkthrough.test.ts` | **this documentation still matches the code** — see below |
| `agentOsDocs.test.ts`, `interopDocs.test.ts`, `interopSchema.test.ts` | shipped docs and schema stay in sync with the code that reads them |

## The style: real files, no mocks

Tests create a temporary directory, write real JSON, call the real function, and
read the result back. There is no filesystem mock and no dependency injection
framework. When output matters, the injectable `log`/`logError` on the `*CliIo`
option types captures it.

The upside is that a passing test means the code works against a real
filesystem, including on Windows. The cost is speed: the suite takes ~30 s, and
two suites spawn processes.

## The documentation test

`tests/walkthrough.test.ts` is unusual enough to explain. It holds a table of
`[file, line, expected text]` for every line number cited by `docs/START_HERE.md`
and `.tours/*.tour`, and asserts each line still contains that text. It also
checks that every tour step points at a real file with an in-range line, and
that every path cited in `START_HERE.md` exists.

**A walkthrough that points at the wrong line is worse than none** — it teaches a
new reader something false and costs them the time to find out. This test is the
drift detector. When it fails, fix the document; do not loosen the expected
string.

## Two honest gaps

1. **A flake was seen and never identified.** During the previous product loop,
   one of six suite runs failed with one test failing and the identity was not
   captured; it did not reproduce in five subsequent runs. Recorded in
   `promotion/PROMOTION_LOG.md`, iteration 1. Suspicion falls on the gate and
   runner tests that assert on elapsed milliseconds. Not fixed, not dismissed.
2. **`proofloop runner resume --clear-stale-lock` has unit coverage but no
   journey.** `promotion/PRODUCT_JOURNEYS.md` says so plainly: the deeper
   recovery path is untested end to end.

## Before you say a change works

The repository's own standard, which is also what its gate enforces:

- run the test command and paste the counts, do not assert them from memory;
- if you touched anything the landing page renders, re-run the browser proof —
  it writes `promotion/evidence/browser-proof/receipt.json` and screenshots;
- if you moved code that `docs/START_HERE.md` or a tour points at,
  `tests/walkthrough.test.ts` will tell you which document to update.
