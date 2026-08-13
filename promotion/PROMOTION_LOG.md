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
| D1 | Major | J5 | Load `/` at any width (verified at 386 px and 2560 px). Type `https://example.com` into `[data-testid="target-input"]`, click `[data-testid="target-submit"]`. The status line renders the single lowercase word **`blocked`** as its entire message, above a raw JSON dump. Cause: `public/app.js:127` passes `data.status` — a machine enum — straight into `setStatus()` as user-facing copy. **Corrected 2026-08-13:** that enum is minted in `api/hosted/submit.js:35` (`status: "blocked"`; also `"dispatch_failed"` at :49, `"queued"` at :60), not in `api/hosted/_shared.js` as this row first said — `_shared.js` owns the nested `permission.status` that appears inside the JSON detail. Open `submit.js` for the enum, `app.js:127` for the copy. The refusal is correct and the JSON even contains the fix instructions; the sentence telling the user what happened is simply missing. This is the primary failure path of the page's main flow. | OPEN |
| D2 | Major | J4, J5 | Same steps as D1, with a screen reader or by inspecting the DOM: `document.querySelector('[data-intake-status]').outerHTML` returns `<p class="status" data-intake-status hidden></p>` — no `role="status"`, no `aria-live`. The page's only dynamic output (success, blocked, GitHub-auth route messages) is therefore never announced; a non-sighted user clicks ProofLoop and hears nothing. Compounding it, success (`#e59579`) and blocked (`#ffb199`) in `public/styles.css:163-170` are distinguished by colour alone — two warm oranges, no icon, no text prefix. | OPEN |
| D3 | Minor | J1 | Run `npm run build`, then `ls public/`. `scripts/build-site.mjs` emits `webcontainer-demo.bundle.js` (362 KB) and `xterm.css` (7 KB) into `public/`, which `vercel.json` declares as the deploy `outputDirectory`. Nothing loads them: `grep -rn "webcontainer" public/index.html public/app.js tests/` matches only `scripts/build-site.mjs` itself. Every deploy ships 369 KB of dead bytes, and `site-src/webcontainer-demo.js` is built on every `pretest` for a page that does not exist. Either the in-browser demo was removed from the page and the build step outlived it, or it was never wired up. Classic unwired mechanism: the build is green and the asset is unreachable. | OPEN |

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
- J2's Enter-to-submit path (`public/app.js:139`) was **not** confirmed with real
  keystrokes: the automation tab was backgrounded (`document.visibilityState ===
  "hidden"`), so synthesized typing never reached the input. Tab-order and
  focus-ring behaviour *were* observed while the tab was foregrounded. Wave 2
  should re-drive Enter with a foregrounded tab before claiming condition 6.

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

_none yet — Wave 1 is baseline only; fixing is Wave 2's job._
