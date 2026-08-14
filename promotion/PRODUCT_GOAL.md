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

**Iteration 2, 2026-08-14.** The first product-code iteration. Two more
producers, both run against the same page through the same
`scripts/serve-public.mjs`: `scripts/web-audit.mjs` (Lighthouse 13.4.1 + axe-core
CLI 4.13.0 → [evidence/web-audit/](evidence/web-audit/)) and
`scripts/wig-review.mjs` (Web Interface Guidelines measurements →
[evidence/wig/](evidence/wig/), judged in
[evidence/wig/REVIEW.md](evidence/wig/REVIEW.md)). Each has a `before/`
sub-directory holding the same producer's output against the unmodified page, so
every claim below is a diff of two committed artifacts. Terminal captures at
[evidence/iteration-2-2026-08-14.md](evidence/iteration-2-2026-08-14.md).

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | PASS | Both halves now exist for all five. Browser: J4/J5 driven in Chromium by the committed `scripts/browser-proof.mjs`, which serves `public/` with the repo's own `api/**` handlers mounted; output at [evidence/browser-proof/](evidence/browser-proof/) — `receipt.json` `"pass": true` plus screenshots of the empty state, the four-command block, and the refusal receipt. Reproduce: `npm ci && npx playwright install chromium && npm run build && npm run proofloop:browser-proof`. Terminal: J1/J3 re-run again at iteration 2 on the changed tree from the committed npm targets ([evidence/iteration-2-2026-08-14.md](evidence/iteration-2-2026-08-14.md)) — `npm test` 28 files / 263 tests / exit 0, `npm run demo` exit 0 still reporting its own two gaps, `npm run proof` exit 0 with three level-5 `partial`s; J2's producer `scripts/record-gate-demo.mjs` is committed and aborts unless the gate refuses then passes, output committed at `docs/media/gate-demo.gif` — **that output predates both iterations**, neither of which changed anything on the gate path. |
| 2 | No critical or major usability defect open | PASS | The ledger is empty of open majors: D3 was deleted in wave 3, **D1 and D2 were fixed in iteration 2 and re-measured in the rendered page** — `browser-proof/receipt.json` → `openDefects` is `[]` where it listed both, and the probe now *asserts* their absence, so a regression fails the run. The independent WIG review found five majors of its own — two of them the same two defects, three nobody had filed — and all five are closed: `wig/receipt.json` → `counts.unresolvedMajor` **0**, against `wig/before/receipt.json` → **5**. One moderate remains open and named (W16, no spinner on the loading button) — moderate is not major, and it is recorded rather than downgraded. |
| 3 | Mobile and desktop both intentional | PASS | Measured, not read off the CSS, by the committed probe at six widths with a screenshot each ([evidence/browser-proof/](evidence/browser-proof/), `receipt.json` → `layout`): the intake grid collapses 2 columns → 1 at ≤620 px, the submit button goes 117 px → 344 px (89% of a 386 px viewport), and the `h1` scales 32 px → 76 px. The probe fails the run if the two ends of the range are the same layout. This independently reproduces Wave 1's ephemeral numbers, which were true and are now retrievable. |
| 4 | No horizontal overflow at supported widths | PASS | `scrollWidth − clientWidth = 0` at 316 / 386 / 620 / 768 / 1280 / 2560, each measured with the J5 refusal JSON rendered — the widest content the page ever holds ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `layout[].overflowPx`, screenshots `layout-*.png`). The probe exits 1 on any positive overflow. |
| 5 | Loading/empty/success/error/agent-running designed | PASS | All four states this surface has are now captured, each in its own screenshot under [evidence/browser-proof/](evidence/browser-proof/). **Empty** — `j4-01-empty-1280.png`, and the probe asserts the status region is present-and-empty rather than absent. **Success** — `j4-02-repo-ready-1280.png`, "GitHub repo target ready." plus the four commands. **Error** — `j5-01-refused-1280.png`, now a sentence naming the host, the reason and the way out, over the receipt (was the bare token `blocked`; D1). **Pending** — `j5-02-pending-1280.png`, new: the previous scorecard said it "was never observed — the response returned faster than a capture", so the probe holds the response open 900 ms with `page.route` and captures the real page's real `Submitting…` state with the button disabled and its label unchanged. No agent-running state exists here, correctly, because the page dispatches work to a worker rather than running an agent in the browser. |
| 6 | Keyboard and basic accessibility pass | PASS | Four measurements, all in the rendered page. **Keyboard:** three real `Tab` presses land on input → `target-submit` → `github-sso`, each with a 2 px `:focus-visible` ring — the third had `outline: 0` and a 1 px border-colour change before this iteration ([evidence/wig/receipt.json](evidence/wig/receipt.json) → W9 vs `wig/before/`). **Announcement:** the status region carries `role="status" aria-live="polite"` and is in the tree before its text changes (W1, and `browser-proof/receipt.json` asserts it on first load). **Not colour-only:** three distinct non-colour cues where there was one (W11). **Touch:** every control ≥ 44 px at 386 px, the GitHub link was 38 px (W13). **Scrolling regions:** the refusal receipt scrolls 284 px of content in 218 px of room and had `tabIndex` −1 with no name — 66 px of the answer was pointer-only; now `tabindex="0"`, named, and it gets the same focus ring (W17). Independently, axe-core 4.13.0 reports **0 violations / 32 passes / 0 incomplete** and Lighthouse accessibility **1.00** — necessary, and by themselves not sufficient, which is exactly what W17 shows: axe implements that rule (`scrollable-region-focusable`) and still passed the page, because it audits the state the page loads in and that panel is `hidden` until a submission is refused. |
| 7 | Web Interface Guidelines: no major unresolved | PASS | A review, not a score: 17 rules quoted verbatim from the Vercel Web Interface Guidelines and judged against the rendered page, written up in [evidence/wig/REVIEW.md](evidence/wig/REVIEW.md) with the measurement behind each finding. **13 failed, five of them major** ([evidence/wig/before/receipt.json](evidence/wig/before/receipt.json)); all five majors and seven of the others are fixed, leaving **1 failing, moderate, named and open** ([evidence/wig/receipt.json](evidence/wig/receipt.json) → `counts`). Producer `scripts/wig-review.mjs` (`npm run proofloop:wig-review`), which exits 1 while any major is unresolved. Deliberately *not* evidenced by condition 8's Lighthouse run: that run scored the page accessibility 1.00, with axe at 0 violations, while all five of these majors were live — including W17, a scrolling receipt panel no keyboard could reach, which axe has a rule for and never evaluated because the panel is `hidden` until a submission is refused. |
| 8 | Web-quality audit: no major unresolved | PASS | Lighthouse 13.4.1 and axe-core CLI 4.13.0, run by the committed `scripts/web-audit.mjs` (`npm run proofloop:web-audit`) against the same local surface, with both raw tool logs and both JSON reports committed at [evidence/web-audit/](evidence/web-audit/). **performance 1.00, accessibility 1.00, best-practices 1.00, SEO 1.00; LCP 807 ms, CLS 0, TBT 0; axe 0 violations, 32 passes, 0 incomplete.** Thresholds are the tools' and Google's, written into the script before the run (axe serious/critical, LCP ≤ 2 500 ms, CLS ≤ 0.1, categories ≥ 0.90) so a bad score cannot become the new bar. LCP is the one figure that moves between runs on a loaded machine — 1 070 / 1 062 / 807 ms across three runs of this producer against this page — and every one of them is far inside the threshold; the committed receipt holds the last. Moved by this iteration: best-practices 0.96 → 1.00, the 404 on `/favicon.ico` ([evidence/web-audit/before/](evidence/web-audit/before/)). Four `*-insight` diagnostics still score below 0.9 and are listed in the receipt's `failingAudits`; three of them (`cache-insight`, `document-latency-insight`, `network-dependency-tree-insight`) describe the local static harness's response headers rather than the Vercel deploy, and `render-blocking-insight` is the single 3 KB stylesheet. None is a category failure and none is claimed as fixed. |
| 9 | No unexplained console errors or failed requests | PASS | The probe records every console message, page error, failed request and response status ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `console`, `responses`): 0 page errors, 0 failed requests, 0 unexplained console errors, and 18 responses of which exactly two are non-2xx — the same refusal, driven twice (once for J5's receipt, once held open to capture the pending state). Lighthouse agrees from the outside: `errors-in-console` **1.00**, where the pre-fix run scored **0** on a `/favicon.ico` 404 ([evidence/web-audit/before/](evidence/web-audit/before/)). That one settles the question the correction left open: **`POST /api/hosted/submit -> 400` is an explained refusal**, because it *is* J5's done-when — the API refusing to point a browser robot at a host the caller has not proven they own. Chromium echoes it into the console a second time as "Failed to load resource", so the probe explains it in both places, matched on URL **and** status, and ships `console.explainedErrors` next to `console.unexplainedErrors`. Any other path or any other status still fails the run. |
| 10 | Performance does not obstruct interaction | PASS | Two independent measurements now agree. In-page: `domContentLoaded` 231 ms, `load` 231 ms, 13 095 B same-origin transfer on first paint; J5's click-to-status latency 190 ms, which includes a live `.well-known` fetch and DNS TXT lookup against example.com. From Lighthouse, on its default mobile emulation with throttling: **LCP 807 ms, CLS 0, TBT 0**, performance **1.00** ([evidence/web-audit/receipt.json](evidence/web-audit/receipt.json) → `lighthouse.coreWebVitals`), all inside Google's "good" thresholds, which `scripts/web-audit.mjs` gates on ([evidence/browser-proof/receipt.json](evidence/browser-proof/receipt.json) → `timings`, `journeys.J5.latencyMs`). Read from `performance.getEntriesByType("navigation")` in the page, not estimated from file sizes, and the probe exits 1 above a 3 000 ms `domContentLoaded` budget. These are the only numbers in the receipt that move between runs — a fresh-clone re-run gave 392 ms / 402 ms on a loaded machine, with every asserted field identical. |
| 11 | Tests and build green | PASS | Producer and output both committed. Re-run at iteration 2 on the changed tree: `npm run build` exit 0 (tsc), `npm test` exit 0 — **28 files, 263 tests, 0 failed**, and `node dist/cli.js gate` PASSED exit 0 with both checks green (`build` 2 820 ms, `tests` 22 109 ms). The parent commit measures 260 on the same machine; all three extra cases are this commit's, and `docs/codebase/TESTING.md` — the single owner of that number — was itself stale at 198 and is corrected. Output retained at [evidence/iteration-2-2026-08-14.md](evidence/iteration-2-2026-08-14.md), earlier runs at [evidence/iteration-1-2026-08-13.md](evidence/iteration-1-2026-08-13.md) and [evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md); reproduce with `npm ci && npm test`. |
| 12 | Verified in the rendered app, not inferred from code | PASS | Iteration 2 is the first product-code change, and every part of it was verified by running the page, not by reading the diff. Each fix has a before value and an after value from the same committed producer: D1 (`journeys.J5.status`), D2 (W1 and W11), the 38 px tap target (W13), the focus ring (W9), `touch-action` (W3), the input `name` (W4), the ellipsis character (W6), `theme-color` (W8), safe areas (W12), error focus (W15), and the favicon 404 (Lighthouse `errors-in-console` 0 → 1.00). The pending state was captured rather than asserted. Nothing in this iteration is claimed from the source alone — and the one MUST that is not fixed (W16) is recorded as failing in the same receipt rather than described as acceptable. |

**Status: PROMOTED** — 12/12 PASS. (0 FAIL, 0 UNVERIFIED.)
Iteration 1 committed the browser probe, which gave 1, 3, 4, 9 and 10 the
producer they lacked. Iteration 2 fixed the product: D1 and D2 closed, four major
Web Interface Guidelines findings closed, and the two audits that had never been
run (7 and 8) run with their reports, their raw logs, their producers and their
pre-fix counterparts committed. See [PROMOTION_LOG.md](PROMOTION_LOG.md)
§ Iteration 2.

**What is still open, so the score is readable rather than clean:** one moderate
Web Interface Guidelines finding (W16 — the loading button has no spinner, kept
open because it is the page's first animation and needs a reduced-motion variant
of its own), and the two gaps this repo's own `npm run demo` reports about itself
(`.proofloop/manifest.json` and root agent instructions). Neither is a major
usability defect and neither is inside a condition. PROMOTED is not "nothing left
to do"; it is "all twelve conditions observed to hold, with an artifact each".
