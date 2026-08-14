# Simplification report — wave 3 (human-readiness)

Measured on Windows 11, Node v22.22.2, npm 10.9.7, from a fresh
`git clone --depth 20` of `HomenShum/NodeProof`.

- **Before** = commit `c21c337` (the tree as cloned).
- **After** = the commit this document ships in.

Every row names the command that produced it. Re-run any of them; if a number
here disagrees with your terminal, the terminal is right and this file is stale.

## The table

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 46 | 44 | −2 | `git ls-files 'src/*.ts' 'api/**/*.js' 'public/*.js' 'public/*.html' 'public/*.css' 'scripts/*.mjs' 'site-src/*.js' \| wc -l` |
| Production source lines | 14,245 | 14,161 | −84 | same file list, `xargs cat \| wc -l` |
| Direct dependencies | 8 | 4 | **−4** | `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies\|\|{}).length+Object.keys(p.devDependencies\|\|{}).length)"` |
| Runtime dependencies | 0 | 0 | 0 | `package.json` has no `dependencies` block — a product promise, unchanged |
| Unused files | 70 | 0 | **−70** | `npx knip@5 --no-exit-code` |
| Unused exports | 0 | 0 | 0 | same run — and see the caveat below, this number is not trustworthy |
| Unused devDependencies | 3 | 0 | −3 | same run |
| Duplicate exports | 1 | 0 | −1 | same run |
| Duplicate blocks | 12 | 12 | 0 | `npx jscpd@4 src api public scripts [site-src] --min-lines 5 --min-tokens 50` |
| Duplicate percentage | 1.04% | 1.04% | 0 | same run |
| Circular dependencies | 0 | 0 | 0 | `npx dependency-cruiser@16 --no-config --output-type err-long src api scripts public` |
| Modules cruised | 84 | 61 | −23 | same run |
| Canonical workflow tests | 27 files / 149 tests | 28 files / 198 tests | +1 file / +49 tests | `npm test` |
| Browser workflow passes | PASS | PASS | — | `node scripts/browser-proof.mjs --port 4509` → `receipt.json` `"pass": true`, `"failures": []` |
| Deployed static output | 379,464 B | 10,432 B | **−97.3%** | `npm run build && du -sb public` |
| Production bundle size | not applicable — the CLI ships as unbundled CommonJS from `tsc`; there is no bundler and no analyzer | | | |
| Additions/deletions | — | — | 35 files, +1,844 / −239 | `git diff --cached --shortstat` |

### Why "production source lines" barely moved, and why that is correct

The gate is explicit that **the target is concepts removed, not line count**.
The two numbers move in opposite directions here and net out at −84:

- **−176 lines deleted** — `site-src/webcontainer-demo.js` (152) and
  `scripts/build-site.mjs` (24), both unreachable.
- **+92 lines added** — plain-language file headers on the eight `src/` modules
  that had none, explaining what each is for and what would go wrong without it.

Denser code would have scored better on the line count and been worse to
inherit. The concepts actually removed are in the next section.

### Caveat on the unused-file and unused-export rows

**`npx knip` behaves differently before and after because `knip.json` is now
committed.** Both halves of that difference are stated here so the row is not
mistaken for pure deletion:

- Before, with no config, knip reported **70 unused files**: 60 of them are
  `dist/**` (compiled output — see below), 1 was the deleted webcontainer
  source, and 9 were `api/**`, `public/app.js` and `scripts/*.mjs` — entry
  points invoked by Vercel, the browser and npm, which knip cannot infer.
- After, `knip.json` declares those entry points and scopes the project to
  hand-written source. The report is **completely empty**: no unused files, no
  unused exports, no unused dependencies, no duplicate exports.
- Deleting the webcontainer demo is what removed the 3 unused devDependencies
  and the 1 duplicate-export finding. The config only removed the noise.

**The unused-exports row of 0 is not trustworthy and should not be read as
evidence.** `src/index.ts` re-exports all 30 modules with `export *`, so every
internal symbol is public API and nothing can ever be reported unused. Recorded
in `docs/codebase/CONCERNS.md`.

## What was deleted

### The in-browser WebContainer demo — an entire build stage, unreachable

This was defect **D3** in `promotion/PROMOTION_LOG.md`, with a reproduction: the
build emitted `public/webcontainer-demo.bundle.js` (361,920 B) and
`public/xterm.css` (7,112 B) into the directory `vercel.json` declares as the
deploy output, and **nothing loaded either file**. `grep -rn "webcontainer"
public/ tests/` matched only the build script itself.

Removed:

| Concept | File / declaration |
|---|---|
| a bundler in the build | `esbuild` devDependency, `scripts/build-site.mjs` |
| an in-browser Node runtime | `@webcontainer/api` devDependency |
| a terminal emulator and its layout addon | `@xterm/xterm`, `@xterm/addon-fit` devDependencies |
| a second build stage | `build:site` npm script; `build` is now just `tsc -p tsconfig.json` |
| a source directory | `site-src/` (152 lines) |
| two `.gitignore` entries for generated files that are no longer generated | `.gitignore` |
| **369,032 bytes shipped on every deploy** | `public/webcontainer-demo.bundle.js`, `public/xterm.css` |

Direct dependencies 8 → 4. The deployed static output is now 10,432 bytes: three
files, all of which the page actually loads.

**Proved not to be a regression**, not assumed: `npm test` (27 files / 149 tests
at that point, unchanged) and `node scripts/browser-proof.mjs --port 4509`, which
drives both landing-page journeys in a real Chromium and returned `"pass": true`
with `"failures": []`. Every asserted field in the receipt came back identical to
the committed one; only run metadata (timestamp, port, three timings) differed.

### Five public API names that were one function

`src/soloSetup.ts` exported `setupSolo` plus four aliases of it —
`installSoloSkill`, `installSoloFounderNodes`, `setupSoloSkill`,
`installSoloFounderSkill` — and a type alias `SoloSetupAgent` for
`SoloSetupAgents`. Zero callers anywhere in the repository, its tests, its docs,
or its workflows (`grep -rn` across all of them). Five names for one concept is
five things a reader must check are not subtly different.

## What custom code was replaced by an existing capability

**Nothing, and that is the finding.** The reuse ladder was applied to every
candidate and each one stopped at rung (a) or (b):

- The gate spawns commands with `node:child_process`; there is no custom process
  layer to replace.
- JSON parsing, path handling, hashing and Ed25519 signing all already use the
  standard library (`node:fs`, `node:path`, `node:crypto`). `src/soloTrust.ts`
  signs with `node:crypto` rather than a JOSE library — correct as it stands.
- The one place a dependency *was* doing work no longer needed doing at all, so
  the answer was deletion, not substitution (rule 4: prefer deletion over
  replacement).
- The MCP server (`src/mcp.ts`, 184 lines) hand-rolls JSON-RPC framing rather
  than using the official SDK. That is a deliberate trade against the
  zero-runtime-dependency promise, which this pass did not spend.

## What was added, and why each earns its place

| Addition | Lines | Why it is not new complexity |
|---|---:|---|
| `docs/START_HERE.md` | 479 | the runtime-order walkthrough the gate requires |
| `docs/codebase/*.md` (7 files) | 733 | stack, structure, architecture, conventions, integrations, testing, concerns |
| `.tours/*.tour` (3 files) | 183 | the same walk inside the editor, pointing at live source |
| `tests/walkthrough.test.ts` | 126 | **executable** protection: 49 assertions that every cited file and line still says what the document claims |
| `knip.json` | 11 | declares the platform entry points knip cannot infer, turning a permanently-noisy signal into a green one |

The only executable additions are the test file and the tool config. No runtime
code was added. No dependency was added.

## Findings left unresolved, with the reason

Each of these is also in `docs/codebase/CONCERNS.md`, where a maintainer will
actually look for it.

| Finding | Why it is still here |
|---|---|
| **D1** — the landing page renders the machine enum `blocked` as its whole user-facing message | writing new user-facing copy is feature work; rule 3 forbids mixing it with a structural pass. Fix shape and file were documented — and **closed 2026-08-14 by the promotion loop**, at `public/app.js:149`, exactly where this row said it belonged. |
| **D2** — the page's status element has no `role="status"`/`aria-live`, and success/blocked differ only by colour | same reason. Both were product fixes owned by the promotion loop; **closed 2026-08-14**. |
| **`dist/` is committed compiled output *and* a runtime dependency** of `api/hosted/_shared.js:2` and `scripts/hosted-worker.mjs:11` | untracking it needs `.gitignore` plus an npm `prepare` script, and interacts with npm's `files` allowlist during packing; the deployed Vercel function path could not be re-verified without a deployment, which was out of scope. The exact steps are written down in CONCERNS.md. |
| **`src/index.ts` `export *` makes dead-export detection impossible** | narrowing the barrel is a breaking change to the published API surface. |
| **`src/maturity.ts:281` scores `live_browser_verification` as `met` from a filename match** | changing a score is a product change. Now stated in the module's own header so nobody trusts it by accident. |
| **COEP/COOP headers in `vercel.json` outlive the demo that needed them** | harmless (the page loads nothing cross-origin) and removing them changes live response headers. |
| **`PROOFLOOP_GITHUB_REPO` still defaults to `"proofloop"`** | verifying the redirect behaviour needs a live token and a real `workflow_dispatch`. |
| **12 duplicate blocks at 1.04%** | 6–16 lines each, in three clusters: the tail of receipt-writing functions (`targetPlan`/`layeredPlan`/`codexRelaunch`/`agentLoop`/`agentAdapters`/`maturity`/`productivity`), two adjacent branches inside `src/runner.ts` (445–494), and the small `sendJson`/`method` helpers shared in shape by `api/hosted/_shared.js` and `api/auth/github/_shared.js`. Extracting helpers would add an indirection to save ~110 lines, and the two `api/**` `_shared` files are deliberately independent so one lane's change cannot break the other. Documented as intentional. |
| **An unidentified test flake** seen once in six runs during the previous loop | not reproduced in this pass either; recorded rather than dismissed. |

## Reproducing this report

```bash
git clone --depth 20 https://github.com/HomenShum/NodeProof.git && cd NodeProof
npm ci
npm test                                    # 28 files, 198 tests
npx knip@5 --no-exit-code                   # empty output
npx jscpd@4 src api public scripts --min-lines 5 --min-tokens 50
npx dependency-cruiser@16 --no-config --output-type err-long src api scripts public
npm run build && du -sb public              # 10432
npx playwright install chromium
node scripts/browser-proof.mjs --port 4509  # PASS
```
