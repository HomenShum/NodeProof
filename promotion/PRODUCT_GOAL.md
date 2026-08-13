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

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | PASS | All 5 canonical journeys driven. J1/J2/J3 in the terminal with recorded exit codes (`npm test` 0, 145 tests / 26 files; `npm run build` 0; `npm run demo` 0; `gate` 1 then 0 across the fix). J4/J5 driven in Chrome against `http://127.0.0.1:4231` with the DOM read after each click. |
| 2 | No critical or major usability defect open | FAIL | 3 defects open, all reproduced: D1 the blocked state renders the bare machine token "blocked" as its only headline; D2 the status region has no `role`/`aria-live`; D3 `npm run build` ships a 362 KB `webcontainer-demo.bundle.js` no page loads. See PROMOTION_LOG defect ledger. |
| 3 | Mobile and desktop both intentional | PASS | The `@media (max-width: 620px)` rule was observed doing real work, not just existing: at a 386 px viewport the input/button grid collapses to one column, the button goes full width (344 px), the GitHub link goes full width, and `h1` clamps to 32 px; at 2560 px they sit side by side. Measured layout in evidence file. |
| 4 | No horizontal overflow at supported widths | PASS | `documentElement.scrollWidth === clientWidth` at 316, 386, 764 and 2560 px — including at 386 px with the blocked-state JSON detail rendered, which is the widest content the page ever shows. |
| 5 | Loading/empty/success/error/agent-running designed | FAIL | Empty (first load) and success ("GitHub repo target ready." + the exact command) are designed. The error state is not: it prints the raw string `blocked` over a raw JSON dump (D1). The `"Submitting..."` pending state was never observed — the response returned faster than a capture. No agent-running state exists on this surface, correctly, because the page dispatches work to a worker rather than running an agent in the browser. |
| 6 | Keyboard and basic accessibility pass | FAIL | Tab order is correct and focus is visible (input → `target-submit` → `github-sso`, 2px solid outline observed on each). But the one dynamic result the page produces is announced to nobody: `<p class="status" data-intake-status hidden>` carries no `role="status"` or `aria-live` (D2), and success vs blocked are separated only by two near-identical warm colors (`#e59579` vs `#ffb199`) with no icon or text prefix. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | No Web Interface Guidelines review was run in this wave. |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | No Lighthouse, axe, or Core Web Vitals audit was run. No audit tool was installed in the time box. |
| 9 | No unexplained console errors or failed requests | PASS | Across a full load + both intake journeys: zero console messages from the page origin (the 6 warnings captured all originate in `chrome-extension://nkbihf…`, a wallet extension, not the page), and every same-origin request returned 200 — `/`, `/styles.css`, `/app.js`, `/api/auth/github/status`, `/api/hosted/submit`. Caveat: served by a local harness that mounts the repo's own `api/*.js` handlers; the `vercel.json` COEP/COOP headers were therefore not applied, so production header behaviour is untested. |
| 10 | Performance does not obstruct interaction | PASS | DOMContentLoaded 317 ms, load 1224 ms, 11.3 KB total same-origin transfer (1.9 KB document + 3.9 KB CSS + 5.5 KB JS). Every click produced its state change before the next tool call could read the DOM; no spinner ever held the UI. |
| 11 | Tests and build green | PASS | `npm run build` exit 0 (tsc + build-site). `npm test` exit 0 — 26 files, 145 tests, 0 failed, 57.94 s. `npm install` exit 0, 52 packages in 11 s. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | Wave 1 is a baseline: no product change was made, so there is no improvement to have verified. This turns PASS or FAIL only once Wave 2 changes something. |

**Status: NOT PROMOTED** — 6/12 PASS.
