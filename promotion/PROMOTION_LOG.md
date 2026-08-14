# Promotion log — NodeProof

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Wave 1 baseline. **No product code was changed.** Every defect below is left
open on purpose so Wave 2 has a starting line to be compared against.

- Environment: fresh `git clone --depth 50` of `HomenShum/NodeProof` at commit
  `ea2eb77`, Windows 11, Node v22.22.2, npm 10.9.7.
- App started: **yes, both surfaces.**
  - CLI: `npm install` (exit 0, 52 packages, 11 s) → `npm run build` (exit 0) →
    `dist/cli.js` runs. This is the product's primary surface.
  - Web: `public/` is static output with `api/*` as Vercel functions; the repo
    has no local server script (`npm run dev` is `tsc --watch`). Started instead
    with a 30-line local harness that serves `public/` and mounts the repo's own
    `api/**/*.js` handlers unchanged, on `http://127.0.0.1:4231`. `vercel dev`
    was not used: it requires an account login, which is out of scope for this
    wave. Consequence recorded honestly in condition 9 — the `vercel.json`
    COEP/COOP headers were not exercised.
- Journeys drivable: **5 of 5.** J1-J3 in a terminal with recorded exit codes,
  J4-J5 in Chrome with the DOM read after every click.
- Scorecard at baseline: see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — recorded as
  **6/12 PASS** on the day, **corrected to 1/12 PASS** (3 FAIL: 2, 5, 6;
  8 UNVERIFIED: 1, 3, 4, 7, 8, 9, 10, 12). See § Correction — 2026-08-13 below.
- Raw captures: [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md).
- This repo was **not** marked DEFERRED in the wave context note.

Why three conditions are UNVERIFIED rather than failed: no Web Interface
Guidelines review (7) and no Lighthouse/axe/Core Web Vitals audit (8) were run in
this wave — no audit tooling was installed inside the time box, and an unrun
audit is not a passing audit. Condition 12 asks whether improvements were
verified in the rendered app; a baseline makes no improvements, so there is
nothing yet to have verified.

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D1 | Major | J5 | Load `/` at any width (verified at 386 px and 2560 px). Type `https://example.com` into `[data-testid="target-input"]`, click `[data-testid="target-submit"]`. The status line renders the single lowercase word **`blocked`** as its entire message, above a raw JSON dump. Cause: the fetch handler in `public/app.js` passed `data.status` — a machine enum — straight into `setStatus()` as user-facing copy (line 127 at the time). **Corrected 2026-08-13:** that enum is minted in `api/hosted/submit.js:35` (`status: "blocked"`; also `"dispatch_failed"` at :49, `"queued"` at :60), not in `api/hosted/_shared.js` as this row first said — `_shared.js` owns the nested `permission.status` that appears inside the JSON detail. Open `submit.js` for the enum, `app.js` for the copy. The refusal is correct and the JSON even contains the fix instructions; the sentence telling the user what happened is simply missing. This is the primary failure path of the page's main flow. | **RESOLVED 2026-08-14 (wave 4)** — `public/app.js:30` `blockedMessage()` is now the one place a machine value becomes copy; the call site is `public/app.js:149`. Re-proved in the rendered page: `promotion/evidence/browser-proof/receipt.json` → `journeys.J5.status` is a sentence and `openDefects` is empty, screenshot `j5-01-refused-1280.png`. |
| D2 | Major | J4, J5 | Same steps as D1, with a screen reader or by inspecting the DOM: `document.querySelector('[data-intake-status]').outerHTML` returns `<p class="status" data-intake-status hidden></p>` — no `role="status"`, no `aria-live`. The page's only dynamic output (success, blocked, GitHub-auth route messages) is therefore never announced; a non-sighted user clicks ProofLoop and hears nothing. Compounding it, queued/github (`public/styles.css:198`, `var(--accent-hover)` = `#e59579`) and blocked (`public/styles.css:207`, `#ffb199`) are distinguished by colour alone — two warm oranges, no icon, no text prefix. | **RESOLVED 2026-08-14 (wave 4)** — `role="status" aria-live="polite"` on the region, and `hidden` removed so it is in the accessibility tree before its text changes; three cues now separate the kinds (colour, a `::before` glyph, and the leading word of the sentence). Re-proved: `promotion/evidence/wig/receipt.json` → W1 and W11 pass, against `wig/before/receipt.json` where both failed. |
| D3 | Minor | J1 | Run `npm run build`, then `ls public/`. `scripts/build-site.mjs` emits `webcontainer-demo.bundle.js` (362 KB) and `xterm.css` (7 KB) into `public/`, which `vercel.json` declares as the deploy `outputDirectory`. Nothing loads them: `grep -rn "webcontainer" public/index.html public/app.js tests/` matches only `scripts/build-site.mjs` itself. Every deploy ships 369 KB of dead bytes, and `site-src/webcontainer-demo.js` is built on every `pretest` for a page that does not exist. Either the in-browser demo was removed from the page and the build step outlived it, or it was never wired up. Classic unwired mechanism: the build is green and the asset is unreachable. | **RESOLVED 2026-08-13 (wave 3)** — deleted, not fixed: `site-src/webcontainer-demo.js`, `scripts/build-site.mjs`, the `build:site` step and four devDependencies are gone. See [docs/SIMPLIFICATION_REPORT.md](../docs/SIMPLIFICATION_REPORT.md). |

### Observations — not defects, no reproduction of harm

- `api/hosted/_shared.js:5` defaults `REPO` to `"proofloop"` while the repository
  is now `HomenShum/NodeProof`. GitHub redirects renamed repositories on most API
  paths, so this may be harmless; confirming it needs a `PROOFLOOP_GITHUB_TOKEN`
  and a real `workflow_dispatch`, which this wave does not do. Recorded, not
  claimed.
- The repo's own `npm run demo` reports `"ready": false` for NodeProof itself,
  listing missing `.proofloop/manifest.json` and missing agent instructions
  (`AGENTS.md` / `CLAUDE.md`) at the root — the README recommends both. Reporting
  its own gaps is the tool working as designed, so this is noted rather than
  filed.
- J2's Enter-to-submit path (`public/app.js:161`) was **not** confirmed with real
  keystrokes: the automation tab was backgrounded (`document.visibilityState ===
  "hidden"`), so synthesized typing never reached the input. Tab-order and
  focus-ring behaviour *were* observed while the tab was foregrounded. Wave 2
  should re-drive Enter with a foregrounded tab before claiming condition 6.

  **Resolved by iteration 1** — `scripts/browser-proof.mjs` types into the input
  and presses Enter with real keystrokes in a foregrounded Chromium page, and
  asserts the same status the click path produces (`receipt.json` →
  `journeys.J4.enterKeySubmits`). Condition 6 still FAILs, on D2, not on this.

- **Resolved by iteration 1** — the `npm run demo` gap listed above ("Playwright/
  browser proof dependency or config"). It was noted as "the tool working as
  designed", which it was, but it was also a defect: the repo could not prove its
  own page, which is the one thing this product sells. `npm run demo` no longer
  reports it. The other two entries — `.proofloop/manifest.json` and root agent
  instructions — remain open and are unclaimed.

## Correction — 2026-08-13

The baseline above was pushed claiming **6/12 PASS**. It is **1/12 PASS**. This
section records both numbers rather than replacing one with the other, because
the way the first number was reached is the thing worth remembering.

What happened, in plain terms: someone measured the page by driving a real
browser, wrote the numbers down, and closed the browser. The numbers were true.
But the only thing pointing at them afterwards was a screenshot handle like
`ss_5046tck1a` — an id that means something to the session that took it and
nothing to anyone else. A reader who clones this repo finds no image, no probe,
no way to check. The gate's artifact rule (NodeKit `templates/promotion/GATE.md`,
§ "Where evidence lives, and what counts as an artifact") wants both halves: the
output committed at a path the row names, **and** the producer — script, test, or
npm target — committed and re-runnable from a fresh clone. Neither half existed
for those rows. **Measured but not retained is UNVERIFIED**, not PASS.

Downgraded, with the reason each row now carries:

| # | Was | Now | Why |
|---|-----|-----|-----|
| 1 | PASS | UNVERIFIED | Terminal half (J1–J3) re-runs from committed npm targets and is retained. Browser half (J4/J5) was driven in Chrome, but the captures are ephemeral handles and the local server harness was never committed — browser journeys driven, probe not retained. The condition names the browser. |
| 3 | PASS | UNVERIFIED | Measured one-column collapse, 344 px button, 32 px `h1` at 386 px and side-by-side at 2560 px; probe not retained. The CSS is readable in the repo, but reading a `@media` block is not observing a layout. |
| 4 | PASS | UNVERIFIED | Measured 0 overflow at 316/386/764/2560; probe not retained. |
| 9 | PASS | UNVERIFIED | Console/network read live, probe not retained — and the capture is wrong where it *can* be checked: it logs `POST /api/hosted/submit 200`, but that handler has no 200 path (`api/hosted/submit.js:33` → 400 blocked, `:47` → 503, `:58` → 202 queued). J5's refusal returned 400. |
| 10 | PASS | UNVERIFIED | Measured DOMContentLoaded 317 ms and ~11.3 KB transfer; probe not retained. Sizes are each the on-disk file plus ~300 B of header, i.e. self-consistent — which is not the same as checkable. |

Kept, and re-cited to retained output:

- **11 — Tests and build green.** Its producers were committed all along
  (`package.json` `build` / `test`). Re-run in a fresh clone at `a604078`:
  `npm install` exit 0, `npm run build` exit 0, `npm test` exit 0 with 26 files /
  145 tests / 0 failed. Output now committed at
  [evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md), which also carries
  `npm run demo` (`"ready": false`, three missing entries) and `npm run proof`
  (`level=5 status=partial`, two `missing=` lines). Reproduce: `npm ci && npm test`.

No row was rescued by writing a new probe. A throwaway script written today to
turn an UNVERIFIED back into a PASS would reproduce the exact failure this
correction exists to fix. The honest fix is Wave 2 committing a real browser
probe — `npm run demo` already names its absence: *"Playwright/browser proof
dependency or config"* is on this repo's own `missing` list.

No product code was touched by this correction.

## Iterations

### Iteration 1 — 2026-08-13

- **Journey exercised:** J4 "Here's my repo, give me the commands" and J5 "Prove
  it won't run against a site I don't own", both driven in a real Chromium; J1
  and J3 re-run in a terminal alongside them.

- **Observed:** the repo could not prove its own page. `npm run demo` reported
  `"playwright": { "declared": false, "configExists": false }` and listed
  **"Playwright/browser proof dependency or config"** among its own `missing`
  entries. Reproduction: `npm ci && npm run build && npm run demo` on `9a837ee`
  — full output in
  [evidence/iteration-1-2026-08-13.md](evidence/iteration-1-2026-08-13.md).

  Root cause, traced upstream rather than at the symptom. The symptom is that
  five scorecard rows (1, 3, 4, 9, 10) had no producer. Why? Because nobody could
  re-run the browser measurements. Why? Because no committed script *starts* the
  landing page — `public/` is a static Vercel deploy with `api/**` as functions,
  and `npm run dev` is `tsc --watch`. Why was there no such script? Because the
  repo assumed `vercel dev`, which needs an account login. So Wave 1 wrote a
  throwaway harness, measured through it, and threw it away — which is precisely
  why those rows were downgraded.

  Under that sits a second, sharper cause: **the Playwright dependency was real
  but undeclared.** `scripts/hosted-worker.mjs:37` and
  `scripts/record-gate-demo.mjs:36` both `await import("playwright")` and print
  "install it yourself first" when it is missing, and
  `.github/workflows/hosted-proofloop.yml:42` installs it with
  `npm install --no-save playwright@1.49.1`. Three callers, one workaround each,
  no entry in `package.json`. That is why the doctor was right about itself.

- **Fixed:** at the shared cause, not per caller.
  - `package.json` — declares `playwright` in `devDependencies` (the package the
    two existing scripts actually import; `@playwright/test`, which the doctor's
    own fix line suggests, would have left both of them still undeclared), and
    adds `proofloop:browser-proof`.
  - `scripts/browser-proof.mjs` (new, ~200 lines, node stdlib + playwright) —
    the missing local server plus the probe. Serves `public/` and mounts the
    repo's own `api/**/*.js` handlers unchanged using Vercel's own routing
    (`cleanUrls: true`), then drives J4 and J5 in Chromium and writes the
    receipt. Binds `127.0.0.1:4310` explicitly and **exits 2 if the port is
    taken** rather than measuring somebody else's dev server.
  - `tests/browserProof.test.ts` (new) — the regression check.
  - No product code was changed. D1, D2 and D3 stay open; the probe now records
    D1 and D2 in `receipt.json` → `openDefects`, so a later fix flips a field a
    reader can diff.

- **Re-proved:** in the rendered app and in a real run.
  - `promotion/evidence/browser-proof/` — `receipt.json` (`"pass": true`,
    `"failures": []`) and nine screenshots, produced by
    `npm run proofloop:browser-proof`. Six widths measured with the J5 refusal
    JSON rendered, all `scrollWidth − clientWidth = 0`; `domContentLoaded`
    198 ms; zero page errors, zero failed requests, zero unexplained console
    errors.
  - `npm run demo` no longer lists the Playwright/browser gap — the product
    reporting, about itself, that the defect is closed.
  - Port note, kept because it is the guard working: 4310 was held by an
    unrelated local server, the probe refused, and the run was repeated with
    `--port 4311`, which the receipt records.
  - **Re-run from a fresh clone of the pushed commit**, which is the half the
    gate actually asks for: `git clone --depth 1 && npm ci && npx playwright
    install chromium && npm run build && node scripts/browser-proof.mjs --port
    4312` → PASS, exit 0. The nine PNGs re-rendered with no diff; `receipt.json`
    differed on six lines, all of them run metadata (timestamp, port, three
    timings). Every asserted field — `pass`, `failures`, the `layout` table,
    `journeys`, the console classification, `openDefects` — came back identical.

- **Tests:** `npm test` → 27 files, 149 tests, 0 failed, exit 0 (baseline 26 /
  145). `npm run build` exit 0. `node dist/cli.js gate` → PASSED, exit 0.
  The four new tests were **confirmed failing on the pre-fix tree** by stashing
  the change and re-running them — see the iteration evidence file for the
  output.

  Honest caveat: **one of six runs of the suite failed with 1 test failing, and
  I did not capture which one.** It was the first run in a fresh clone, took
  45 s against a normal 18 s, and did not reproduce in the five runs after it
  (two in-tree, three more in the fresh clone), all 149/149. The four new tests
  read committed files and parse JSON with no timing or ordering dependency, so
  they are not plausible candidates; the suite does contain gate and runner
  tests that assert on elapsed milliseconds. Recorded as an **unidentified
  pre-existing flake under machine contention**, not claimed as fixed, not
  claimed as innocent.

- **Conditions newly PASS:** 1, 3, 4, 9, 10. Scorecard 1/12 → 6/12.

- **Deliberately not claimed.** 2, 5 and 6 stay FAIL — D1, D2 and D3 are still
  open and this iteration fixed one defect, not four. 7 and 8 stay UNVERIFIED —
  no Web Interface Guidelines review and no Lighthouse/axe run happened. 12 stays
  UNVERIFIED — it asks whether *improvements were verified in the rendered app*,
  and this iteration improved the proof apparatus rather than the page; the first
  product-code fix is what turns it.

- **New observation, not a defect:** `src/maturity.ts:281` scores
  `live_browser_verification` as `met` whenever `scripts/hosted-worker.mjs`
  merely *exists*. It read `met` before this iteration, when nothing in the repo
  could open a browser. The capability check matches a filename, not a runnable
  path. Recorded here; not claimed as fixed.

### Iteration 2 — 2026-08-14

Dates here are UTC, which is what every `capturedAt` in the receipts says; the
local clock was still 2026-08-13.

- **Journey exercised:** J5 "Prove it won't run against a site I don't own" —
  the refusal path, which is where both remaining product defects lived — plus
  J4 in the same run, and J1/J3 re-run in a terminal on the changed tree.

- **Observed.** Two audits had never been run at all (conditions 7 and 8), and
  the previous wave said so honestly: *"no audit tooling was installed inside the
  time box"*. Run now, they say two different things, and the difference is the
  finding:

  - **Condition 8's tools passed the broken page.** Against the unmodified page,
    Lighthouse 13.4.1 scored **accessibility 1.00** and axe-core 4.13.0 found
    **0 violations** — while D1 and D2 were both live and a third defect nobody
    had filed was too. Committed at
    [evidence/web-audit/before/](evidence/web-audit/before/). Their one real
    complaint was best-practices **0.96**, a 404 on `/favicon.ico`.
  - **Condition 7 found what they could not.** Seventeen Web Interface Guidelines
    rules judged against the rendered page: **13 failed, five of them major**
    ([evidence/wig/before/receipt.json](evidence/wig/before/receipt.json)). The
    five majors were D1 (the error state prints a machine enum and offers no way
    out), D2 (the only live region is not a live region), the same status colours
    being the *only* cue distinguishing success from refusal, a **38 px** tap
    target on `Continue with GitHub` at 386 px — six pixels under the 44 px floor,
    on the one control that leaves the page — and W17: the refusal receipt is a
    scrolling box (284 px of content in 218 px of room) with `tabIndex` −1 and no
    accessible name, so 66 px of the answer, including one of the two ways to
    prove domain ownership, was reachable only with a pointer.
  - **W17 is the sharp one**, because axe *has* a rule for it
    (`scrollable-region-focusable`, impact serious) and still reported zero
    violations: axe audits the page as it loads, and that panel is `hidden` until
    a submission is refused. An automated pass that never opens the failure state
    cannot see the failure state. It was found by driving the page into the state
    the user complains about, which is what a review is for.

  This is the reason the gate keeps 7 and 8 as separate rows, and the reason a
  Lighthouse score must never be recorded as a Web Interface Guidelines review.

- **Fixed** — the first product-code change in this loop. Root cause each time,
  not the symptom:

  - `public/app.js` — `blockedMessage()` is now the single place an API enum
    becomes user-facing copy. Not a patch at the call site: every branch that can
    render a machine value goes through it, so `dispatch_failed` and a network
    failure get sentences too. The receipt JSON stays underneath, because it is
    J5's entire point; it is now evidence under a sentence instead of the answer.
  - `public/index.html` — `role="status" aria-live="polite"`, and the `hidden`
    attribute **removed**. The removal is the fix: a live region has to be in the
    accessibility tree before its text changes, so revealing and filling it in
    the same moment still announces nothing. Also `name="target"` on the input, a
    `theme-color`, and an inline SVG favicon that removes the page's only console
    error.
  - `public/styles.css` — `min-height: 44px` on the GitHub link, the same 2 px
    focus ring the other two controls already had (it had `outline: 0` and a 1 px
    border-colour change), `touch-action: manipulation`, safe-area insets, and a
    `::before` glyph per status kind so colour is no longer the only cue.
  - `public/index.html` + `public/styles.css` — `tabindex="0"`, an
    `aria-label`, and a focus ring on the receipt panel, so the scrolling box
    holding the answer is reachable from the keyboard (W17).
  - `scripts/serve-public.mjs` — extracted from `scripts/browser-proof.mjs` so
    the new audits measure the *same* server. Two probes measuring two servers
    would not be measuring one page.
  - `scripts/web-audit.mjs`, `scripts/wig-review.mjs` — the two producers
    conditions 7 and 8 lacked, plus `npm run proofloop:web-audit` and
    `npm run proofloop:wig-review`.

- **Re-proved** in the rendered page, every item, with a before and an after from
  the same producer (`git stash push -- public`, run, restore, run):

  - `browser-proof/receipt.json` → `openDefects` `[]` where it listed D1 and D2,
    and the probe now **asserts** their absence, so a regression fails the run
    instead of being re-recorded.
  - `wig/receipt.json` → 1 failing of 17, `unresolvedMajor` **0**, against
    `wig/before/receipt.json` → 13 failing, 5 major.
  - `web-audit/receipt.json` → 1.00 / 1.00 / 1.00 / 1.00, LCP 807 ms, CLS 0,
    TBT 0, axe 0 violations; best-practices 0.96 → 1.00.
  - `j5-02-pending-1280.png` — the `Submitting…` state the scorecard said was
    "never observed", captured by holding the response open 900 ms with
    `page.route`. The page is unmodified; only the network is slowed.

- **Tests:** `npm test` → 28 files, 263 tests, 0 failed, exit 0. `npm run build`
  exit 0. `node dist/cli.js gate` → PASSED, exit 0. The parent commit measures
  **260** on this machine, so `docs/codebase/TESTING.md` — which owns that
  number and said **198** — was already stale and is corrected to 263.
  Documentation anchors were rebound to the lines the code moved to
  (`tests/walkthrough.test.ts`, `.tours/03-debug-and-recovery.tour`), not
  loosened.

- **Conditions newly PASS:** 2, 5, 6, 7, 8, 12. Scorecard 6/12 → **12/12,
  PROMOTED**.

- **Left open, deliberately, and not counted as passing.** W16 — "MUST: Loading
  buttons show spinner and keep original label". The label half holds and is
  captured; the spinner does not exist. A spinner would be this page's first
  animation, which needs a `prefers-reduced-motion` variant and a reason of its
  own, and the pending state is already announced in text through the live region
  this iteration added. Recorded as a failing moderate in
  `wig/receipt.json`, not argued away.

- **Two failures of the new tooling, both worth the next reader's time**, written
  up in [evidence/iteration-2-2026-08-14.md](evidence/iteration-2-2026-08-14.md):
  `spawnSync` blocked the event loop of the process serving the page under audit,
  so Lighthouse reported *"The page did not paint any content (NO_FCP)"* — a
  sentence that reads like a page defect and was the probe holding the door shut;
  and `@axe-core/cli --save` joins its argument onto the current directory, so an
  absolute path produced `0 violations found!` followed by `Unable to save file!`
  — a clean audit with no artifact, which under this gate is worth nothing.
