# Product goal — NodeProof

## Who opens this, and what they are trying to finish

Someone is building an app with the help of a coding assistant. The assistant
edits files for twenty minutes, then announces that the feature is finished.
They have been burned by that sentence before: the last three times it said
"done," the tests were failing, or the page it swore it had fixed still threw
the same error. They do not want to read every diff to find out — they want a
referee. They arrive at NodeProof to install that referee: something outside the
assistant that runs the app's real checks, and refuses to accept "done" as an
answer until those checks actually pass. What they walk away holding is a
one-command gate wired into their own repo — a command they, their teammates, or
CI can run that exits 0 only when the build and tests really pass, a recorded
verdict file they can read afterwards, and (for Claude Code and Codex) a hook
that stops the assistant from ending its turn while that verdict says FAILED.
The tool they installed is a command-line program, `npx proofloop`, plus a small
web page at proofloop.live where they can hand a URL or repository over to a
hosted version of the same run.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `reduced` <!-- reduced = library/CLI judged on its demo
surface and quickstart; see the GATE's reduced-gate section -->

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline measured 2026-08-13 on commit `ea2eb77`, in a fresh clone, Windows 11 /
Node v22.22.2 / npm 10.9.7. Raw captures:
[evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md).

**Corrected 2026-08-13 (see [PROMOTION_LOG.md](PROMOTION_LOG.md) § Correction).**
The baseline scored 6 rows PASS on measurements taken through an ephemeral
browser session. Under the gate's artifact rule an artifact needs both halves —
the output committed at a path the row names, and the producer committed and
re-runnable by someone who just cloned the repo — so those measurements are real
but their evidence is not retrievable. Five rows are now UNVERIFIED with the
reason stated in those terms. The one row whose producer is a committed npm
target was re-run and its output retained:
[evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md).

**Iteration 1, 2026-08-13.** Those five rows now have a producer:
`scripts/browser-proof.mjs`, run by `npm run proofloop:browser-proof`, serves the
page locally and drives it in a real Chromium. Output at
[evidence/browser-proof/](evidence/browser-proof/), terminal captures at
[evidence/iteration-1-2026-08-13.md](evidence/iteration-1-2026-08-13.md).

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | PASS | Both halves now exist for all five. Browser: J4/J5 driven in Chromium by the committed `scripts/browser-proof.mjs`, which serves `public/` with the repo's own `api/**` handlers mounted; output at [evidence/browser-proof/](evidence/browser-proof/) — `receipt.json` `"pass": true` plus screenshots of the empty state, the four-command block, and the refusal receipt. Reproduce: `npm ci && npx playwright install chromium && npm run build && npm run proofloop:browser-proof`. Terminal: J1/J3 re-run this iteration from committed npm targets ([evidence/iteration-1-2026-08-13.md](evidence/iteration-1-2026-08-13.md)); J2's producer `scripts/record-gate-demo.mjs` is committed and aborts unless the gate refuses then passes, output committed at `docs/media/gate-demo.gif` — **that output predates this iteration**, which changed nothing on the gate path. |
| 2 | No critical or major usability defect open | FAIL | 3 defects open, all reproduced: D1 the blocked state renders the bare machine token "blocked" as its only headline; D2 the status region has no `role`/`aria-live`; D3 `npm run build` ships a 362 KB `webcontainer-demo.bundle.js` no page loads. See PROMOTION_LOG defect ledger. |
| 3 | Mobile and desktop both intentional | PASS | Measured, not read off the CSS, by the committed probe at six widths with a screenshot each ([evidence/browser-proof/](evidence/browser-proof/), `receipt.json` → `layout`): the intake grid collapses 2 columns → 1 at ≤620 px, the submit button goes 117 px → 344 px (89% of a 386 px viewport), and the `h1` scales 32 px → 76 px. The probe fails the run if the two ends of the range are the same layout. This independently reproduces Wave 1's ephemeral numbers, which were true and are now retrievable. |
| 4 | No horizontal overflow at supported widths | PASS | `scrollWidth − clientWidth = 0` at 316 / 386 / 620 / 768 / 1280 / 2560, each measured with the J5 refusal JSON rendered — the widest content the page ever holds ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `layout[].overflowPx`, screenshots `layout-*.png`). The probe exits 1 on any positive overflow. |
| 5 | Loading/empty/success/error/agent-running designed | FAIL | Empty (first load) and success ("GitHub repo target ready." + the exact command) are designed. The error state is not: it prints the raw string `blocked` over a raw JSON dump (D1). The `"Submitting..."` pending state was never observed — the response returned faster than a capture. No agent-running state exists on this surface, correctly, because the page dispatches work to a worker rather than running an agent in the browser. |
| 6 | Keyboard and basic accessibility pass | FAIL | Tab order is correct and focus is visible (input → `target-submit` → `github-sso`, 2px solid outline observed on each). But the one dynamic result the page produces is announced to nobody: `<p class="status" data-intake-status hidden>` carries no `role="status"` or `aria-live` (D2), and success vs blocked are separated only by two near-identical warm colors (`#e59579` vs `#ffb199`) with no icon or text prefix. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | No Web Interface Guidelines review was run in this wave. |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | No Lighthouse, axe, or Core Web Vitals audit was run. No audit tool was installed in the time box. |
| 9 | No unexplained console errors or failed requests | PASS | The probe records every console message, page error, failed request and response status ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `console`, `responses`): 0 page errors, 0 failed requests, 0 unexplained console errors, and 13 responses of which exactly one is non-2xx. That one settles the question the correction left open: **`POST /api/hosted/submit -> 400` is an explained refusal**, because it *is* J5's done-when — the API refusing to point a browser robot at a host the caller has not proven they own. Chromium echoes it into the console a second time as "Failed to load resource", so the probe explains it in both places, matched on URL **and** status, and ships `console.explainedErrors` next to `console.unexplainedErrors`. Any other path or any other status still fails the run. |
| 10 | Performance does not obstruct interaction | PASS | `domContentLoaded` 198 ms, `load` 198 ms, 9 874 B same-origin transfer on first paint; J5's click-to-status latency 346 ms, which includes a live `.well-known` fetch and DNS TXT lookup against example.com ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `timings`, `journeys.J5.latencyMs`). Read from `performance.getEntriesByType("navigation")` in the page, not estimated from file sizes, and the probe exits 1 above a 3 000 ms `domContentLoaded` budget. These are the only numbers in the receipt that move between runs — a fresh-clone re-run gave 392 ms / 402 ms on a loaded machine, with every asserted field identical. |
| 11 | Tests and build green | PASS | Producer and output both committed. Re-run at iteration 1 from the committed npm targets: `npm run build` exit 0 (tsc + build-site), `npm test` exit 0 — **27 files, 149 tests, 0 failed** (baseline 26 / 145; the 4 new tests are `tests/browserProof.test.ts`, confirmed failing on the pre-fix tree), `node dist/cli.js gate` PASSED exit 0. Output retained at [evidence/iteration-1-2026-08-13.md](evidence/iteration-1-2026-08-13.md), earlier run at [evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md); reproduce with `npm ci && npm test`. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | Iteration 1 changed the proof apparatus, not the page: it committed the browser probe the repo's own `npm run demo` reported missing. That was verified by running it — a real Chromium, retained screenshots, and the doctor's `missing` list losing the Playwright line — but the condition asks whether *product improvements* were verified in the rendered app, and this iteration made none. It turns PASS on the first product-code fix, which now has a probe to be proved with. |

**Status: NOT PROMOTED** — 6/12 PASS. (3 FAIL: 2, 5, 6. 3 UNVERIFIED: 7, 8, 12.)
Iteration 1 committed the browser probe, which gave 1, 3, 4, 9 and 10 the
producer they lacked; 11 was re-run against the changed tree. See
[PROMOTION_LOG.md](PROMOTION_LOG.md) § Iteration 1. The three FAIL rows are the
three open defects D1/D2/D3, unfixed on purpose — one iteration, one defect.
