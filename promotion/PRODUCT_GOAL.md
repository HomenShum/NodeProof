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

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | Terminal half retained: J1/J2/J3 re-run from committed npm targets, exit 0 each ([evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md)). Browser half not: J4/J5 were driven in Chrome against `http://127.0.0.1:4231` with the DOM read after each click, but the captures are ephemeral browser-MCP handles and the local harness that served the page was never committed — browser journeys driven, probe not retained. This condition names the browser, so terminal evidence alone cannot carry it. |
| 2 | No critical or major usability defect open | FAIL | 3 defects open, all reproduced: D1 the blocked state renders the bare machine token "blocked" as its only headline; D2 the status region has no `role`/`aria-live`; D3 `npm run build` ships a 362 KB `webcontainer-demo.bundle.js` no page loads. See PROMOTION_LOG defect ledger. |
| 3 | Mobile and desktop both intentional | UNVERIFIED | Measured one-column collapse, 344 px full-width button and 32 px `h1` at 386 px, side-by-side at 2560 px — **probe not retained**. The `@media (max-width: 620px)` block and the `clamp(2rem, …)` floor are readable in `public/styles.css`, but reading CSS is not observing layout, and the viewport measurement lives only in an ephemeral browser session. No committed producer resizes this page. |
| 4 | No horizontal overflow at supported widths | UNVERIFIED | Measured `scrollWidth === clientWidth` (0 overflow) at 316/386/764/2560, including 386 px with the blocked-state JSON rendered — **probe not retained**. Same reason as condition 3: the numbers were real, the tool that produced them was never committed. |
| 5 | Loading/empty/success/error/agent-running designed | FAIL | Empty (first load) and success ("GitHub repo target ready." + the exact command) are designed. The error state is not: it prints the raw string `blocked` over a raw JSON dump (D1). The `"Submitting..."` pending state was never observed — the response returned faster than a capture. No agent-running state exists on this surface, correctly, because the page dispatches work to a worker rather than running an agent in the browser. |
| 6 | Keyboard and basic accessibility pass | FAIL | Tab order is correct and focus is visible (input → `target-submit` → `github-sso`, 2px solid outline observed on each). But the one dynamic result the page produces is announced to nobody: `<p class="status" data-intake-status hidden>` carries no `role="status"` or `aria-live` (D2), and success vs blocked are separated only by two near-identical warm colors (`#e59579` vs `#ffb199`) with no icon or text prefix. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | No Web Interface Guidelines review was run in this wave. |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | No Lighthouse, axe, or Core Web Vitals audit was run. No audit tool was installed in the time box. |
| 9 | No unexplained console errors or failed requests | UNVERIFIED | Console and network were read live (0 page-origin messages; the 6 warnings all from a wallet extension) — **probe not retained**, so no reader can re-open that session. The recorded status codes are also wrong: the baseline logged `POST /api/hosted/submit 200`, but `api/hosted/submit.js` has no 200 path — `:33` returns **400** with `status:"blocked"`, `:47` returns 503, `:58` returns 202. The blocked journey therefore returned 400. Whether that 4xx counts as an *explained* refusal or a failed request cannot be settled without re-observing the network, which needs a producer this repo does not have. |
| 10 | Performance does not obstruct interaction | UNVERIFIED | Measured DOMContentLoaded 317 ms, load 1224 ms, ~11.3 KB same-origin transfer — **probe not retained**. The transfer figures are each the on-disk file size plus ~300 B of header, so they are self-consistent, but self-consistency is not evidence: the timing session cannot be re-opened and no committed producer replays it. |
| 11 | Tests and build green | PASS | Producer and output both committed. Re-run in a fresh clone at `a604078` from the committed npm targets: `npm install` exit 0 (52 packages), `npm run build` exit 0 (tsc + build-site), `npm test` exit 0 — 26 files, 145 tests, 0 failed. Output retained at [evidence/rerun-2026-08-13.md](evidence/rerun-2026-08-13.md); reproduce with `npm ci && npm test`. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | Wave 1 is a baseline: no product change was made, so there is no improvement to have verified. This turns PASS or FAIL only once Wave 2 changes something. |

**Status: NOT PROMOTED** — 1/12 PASS. (3 FAIL: 2, 5, 6. 8 UNVERIFIED: 1, 3, 4,
7, 8, 9, 10, 12. Was recorded as 6/12; corrected 2026-08-13 — five rows were
measured through a browser session whose probe was never committed.)
