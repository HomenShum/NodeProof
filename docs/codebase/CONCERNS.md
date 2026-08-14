# Concerns

Everything a new maintainer should know that is *not* good news. Each entry says
what it is, how to see it, and why it is still here. Nothing on this list is
hidden anywhere else in the packet.

## Product defects (from the promotion loop)

Reproductions live in `promotion/PROMOTION_LOG.md`. D1 and D2 were open through
the structural pass — that pass answers to a gate forbidding feature work mixed
with refactoring, and both fixes are feature work. **Both were closed on
2026-08-14 (wave 4)**, and are kept here with what they were, because the shape
of the bug is the useful part.

### D1 — the landing page's main failure path showed the word `blocked`

**Severity: major. CLOSED 2026-08-14.** Load `/`, type `https://example.com`,
submit. The status line's entire message was the single lowercase word
**`blocked`**, above a raw JSON dump.

**Cause:** `public/app.js` passed `data.status` — a machine enum minted at
`api/hosted/submit.js:35` — straight into `setStatus()` as user-facing copy.
The refusal itself was correct and the JSON even contained the fix instructions;
the sentence telling the user what happened was missing.

**Fixed** where the enum becomes copy, not at the API: `public/app.js:30`
`blockedMessage()`, called at `public/app.js:149`. The API contract that
`tests/hostedApi.test.ts` asserts is untouched. Proof: the headline is a sentence
in `promotion/evidence/browser-proof/receipt.json` → `journeys.J5.status`.

### D2 — the page's only dynamic output was announced to nobody

**Severity: major. CLOSED 2026-08-14.**
`document.querySelector('[data-intake-status]').outerHTML` returned
`<p class="status" data-intake-status hidden></p>` — no `role="status"`, no
`aria-live`. Every message the page produced (success, blocked, GitHub auth) was
silent to a screen reader. Compounding it, queued/github (`public/styles.css:198`,
`var(--accent-hover)` = `#e59579`) and blocked (`public/styles.css:207`, `#ffb199`)
were two warm oranges distinguished by colour alone — no icon, no text prefix.

**Fixed** in `public/index.html` (`role="status" aria-live="polite"`, and the
`hidden` attribute removed — a live region has to be in the accessibility tree
before its text changes or nothing is announced) and `public/styles.css` (a
`::before` glyph per kind). Proof: `promotion/evidence/wig/receipt.json` → W1,
W11, against `wig/before/receipt.json` where both failed.

## Structural findings left unresolved

### `dist/` is compiled output, committed, and a runtime dependency

Three properties at once. `api/hosted/_shared.js:2` and
`scripts/hosted-worker.mjs:11` `require()` the compiled `dist/`, so it is not
merely a build artefact.

**The cost, concretely:** `dist/` is 60 of the repository's 215 tracked files.
It can drift from `src/` with nothing detecting it. On Windows, a rebuild marks all 60 modified in
`git status` while `git diff` shows no content change — line-ending churn that
buries the real diff.

**Why it was not changed here:** untracking it needs `dist/` in `.gitignore`,
which interacts with npm's `files` allowlist during packing, plus an npm
`prepare` script so a fresh clone still has a binary — and the deployed Vercel
function path could not be re-verified without a deployment, which was out of
scope. The safe change is a small one made deliberately, not a side effect of a
documentation pass.

**If you take it on:** add `dist/` to `.gitignore`, add `"prepare": "npm run
build"` (it replaces `prepublishOnly`), verify `npm pack` still contains
`dist/`, and verify a Vercel preview deploy before merging.

### `src/index.ts` re-exports everything, so dead code cannot be detected

`export *` of all 30 modules makes the entire internal surface public API, which
means `knip` reports **zero** unused exports whether or not any exist. Narrowing
it would find real dead code, and would be a breaking change for anyone who
imports the package rather than running the CLI.

### `maturity` scores a capability `met` from a filename

`src/maturity.ts:281` marks `live_browser_verification` as `met` when
`scripts/hosted-worker.mjs` merely *exists*. It read `met` at a commit where
nothing in the repository could open a browser. The check matches a path, not a
runnable path. Recorded in `promotion/PROMOTION_LOG.md` and in the module's own
header; not fixed here because changing a score is a product change.

### COEP/COOP headers outlive their reason

`vercel.json` sets `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin`. They were required by an in-browser
WebContainer demo that this pass deleted (defect D3). The page loads no
cross-origin resources, so they are harmless and arguably good hardening — but
they are now unexplained by the code that remains. Removing them changes
response headers on a live deployment, which is not a documentation pass's
business.

### `PROOFLOOP_GITHUB_REPO` still defaults to the old repository name

`api/hosted/_shared.js:5` defaults to `"proofloop"`; the repository is
`HomenShum/NodeProof`. GitHub redirects renamed repositories on most API paths,
so this may be harmless — confirming it needs a live token and a real
`workflow_dispatch`. Recorded as an observation, not claimed either way.

## Test concerns

### An unidentified flake

One of six suite runs during the previous loop failed with one test failing, and
which test was not captured. Five subsequent runs passed 149/149. The suite
contains gate and runner tests that assert on elapsed milliseconds, which is
where suspicion sits. It is recorded rather than dismissed.

### An untested recovery path

`proofloop runner resume --clear-stale-lock` has unit coverage but no journey
exercising it end to end. `promotion/PRODUCT_JOURNEYS.md` says so in its own
words: "the deeper form and is **not** covered by any journey here — untested."

## Scale concerns, stated without alarm

- **`src/cli.ts` is 1053 lines and dispatches ~28 commands.** It is flat and
  readable and every case is three lines, so it is fine — but the *product* has
  28 commands, which is a lot for a tool whose value is one of them. That is a
  product question, not a refactoring one.
- **Four modules are over 700 lines** (`soloInterop` 1405, `proofloopHooks`
  1079, `soloSetup` 896, `runner` 892). `proofloopHooks` is large because it
  embeds three generated scripts as template strings, which is the right call —
  those scripts must be standalone. The others are large because their domains
  are.
- **`.proofloop/` state has no cleanup.** Every run leaves a directory under
  `.proofloop/runs/` or `.proofloop/runner/runs/` forever. In a long-lived
  repository driven by an agent loop, that grows without bound. No eviction, no
  cap, no `prune` command.
