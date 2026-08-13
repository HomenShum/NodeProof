# Concerns

Everything a new maintainer should know that is *not* good news. Each entry says
what it is, how to see it, and why it is still here. Nothing on this list is
hidden anywhere else in the packet.

## Open product defects (from the promotion loop)

These have reproductions in `promotion/PROMOTION_LOG.md` and are **user-visible
today**. They were left open by this structural pass on purpose: the gate this
pass answers to forbids mixing feature work with refactoring, and fixing D1
means writing new user-facing copy.

### D1 — the landing page's main failure path shows the word `blocked`

**Severity: major.** Load `/`, type `https://example.com`, submit. The status
line's entire message is the single lowercase word **`blocked`**, above a raw
JSON dump.

**Cause:** `public/app.js:127` passes `data.status` — a machine enum minted at
`api/hosted/submit.js:35` — straight into `setStatus()` as user-facing copy.
The refusal itself is correct and the JSON even contains the fix instructions;
the sentence telling the user what happened is missing.

**Fix shape:** map the enum to a sentence in `public/app.js`. Do not change the
API — the enum is the machine contract and `tests/hostedApi.test.ts` asserts it.

### D2 — the page's only dynamic output is announced to nobody

**Severity: major.** `document.querySelector('[data-intake-status]').outerHTML`
returns `<p class="status" data-intake-status hidden></p>` — no `role="status"`,
no `aria-live`. Every message the page produces (success, blocked, GitHub auth)
is silent to a screen reader. Compounding it, success (`#e59579`) and blocked
(`#ffb199`) in `public/styles.css:163-170` are two warm oranges distinguished by
colour alone — no icon, no text prefix.

**Fix shape:** `role="status" aria-live="polite"` on the element, plus a
non-colour distinction. Both are in `public/index.html` / `public/styles.css`.

## Structural findings left unresolved

### `dist/` is compiled output, committed, and a runtime dependency

Three properties at once. `api/hosted/_shared.js:2` and
`scripts/hosted-worker.mjs:11` `require()` the compiled `dist/`, so it is not
merely a build artefact.

**The cost, concretely:** `dist/` is 60 tracked files, roughly a third of the
repository, and `npx knip` counts every one of them as unused. It can drift from
`src/` with nothing detecting it. On Windows, a rebuild marks all 60 modified in
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

`src/maturity.ts:270` marks `live_browser_verification` as `met` when
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
