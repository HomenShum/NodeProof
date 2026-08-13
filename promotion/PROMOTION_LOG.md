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
- Scorecard at baseline: see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — **6/12 PASS**,
  3 FAIL (2, 5, 6), 3 UNVERIFIED (7, 8, 12).
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
| D1 | Major | J5 | Load `/` at any width (verified at 386 px and 2560 px). Type `https://example.com` into `[data-testid="target-input"]`, click `[data-testid="target-submit"]`. The status line renders the single lowercase word **`blocked`** as its entire message, above a raw JSON dump. Cause: `public/app.js:127` passes `data.status` — a machine enum from `api/hosted/_shared.js` — straight into `setStatus()` as user-facing copy. The refusal is correct and the JSON even contains the fix instructions; the sentence telling the user what happened is simply missing. This is the primary failure path of the page's main flow. | OPEN |
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

## Iterations

_none yet — Wave 1 is baseline only; fixing is Wave 2's job._
