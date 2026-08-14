# Web Interface Guidelines review — proofloop.live landing page

Condition 7 of [the PROMOTION gate](https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md).
Reviewed 2026-08-13 against the Vercel **Web Interface Guidelines**
(https://vercel.com/design/guidelines; the rule text quoted below is the raw
source at
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/AGENTS.md,
fetched the same day).

**This is a review, not an audit score.** Condition 8's Lighthouse and axe run is
a different artifact ([../web-audit/](../web-audit/)) measuring different things.
Every finding here was invisible to both tools: Lighthouse scored this page
**accessibility 1.00**, and axe found **0 violations**, while the only dynamic
thing on the page was announced to nobody, its refusal headline was the word
`blocked`, its one link was a 38 px tap target, and the receipt panel was a
scrolling box no keyboard could reach. A score cannot stand in for reading the
rules against the page.

The last of those says something specific about the limits of an automated
audit, and it is worth saying out loud: **axe audits the page as it loads.** The
receipt panel is `hidden` until a submission fails, so no automated pass in this
repository has ever evaluated it. That is not a criticism of axe — it is the
reason a review drives the page into the state the user complains about, and the
reason W17 below exists.

- Surface reviewed: `public/index.html` + `public/app.js` + `public/styles.css`,
  served with the repo's own `api/**` handlers by `scripts/serve-public.mjs`.
- Measurements: `scripts/wig-review.mjs` (`npm run proofloop:wig-review`).
  - before the fixes → [`before/receipt.json`](before/receipt.json) — 17 rules
    checked, **13 failed, 5 of them major**
  - after → [`receipt.json`](receipt.json) — **1 failed, 0 major**
  - the before receipt was produced by the *same* script, run against the
    unmodified page (`git stash push -- public`), so the two files diff
    field-for-field.
- Screenshots: [`before/wig-blocked-state-1280.png`](before/wig-blocked-state-1280.png)
  vs [`wig-blocked-state-1280.png`](wig-blocked-state-1280.png), and
  [`before/wig-mobile-targets-0386.png`](before/wig-mobile-targets-0386.png) vs
  [`wig-mobile-targets-0386.png`](wig-mobile-targets-0386.png).

## Severity, defined before the findings

- **major** — a MUST rule whose breach removes a whole class of user (screen
  reader, touch, keyboard) from the page's one journey, or leaves any user with
  no idea what happened.
- **moderate** — a MUST rule whose breach degrades the experience without
  stopping it.
- **minor** — a SHOULD rule, or a MUST with cosmetic blast radius.

## Major findings — all five resolved

### W1 · The one thing this page says out loud was said to nobody

*Interactions › Feedback — "MUST: Use polite `aria-live` for toasts/inline
validation".*

Someone using a screen reader pastes a repo, presses ProofLoop, and hears
nothing at all. The page answered — success, refusal, a GitHub sign-in message —
by writing text into `<p class="status" data-intake-status hidden>`, an element
with no `role` and no `aria-live` (before/receipt.json → W1). A region that is
not marked as live is not announced when its text changes, and this page has no
other output: the entire result of the entire journey was silent.

**Fixed** in `public/index.html`: `role="status" aria-live="polite"`, and the
`hidden` attribute removed. The removal is the part that matters and is easy to
get wrong — a live region has to already be in the accessibility tree *before*
its text changes, so an element that is revealed and filled in the same moment
still announces nothing. Empty text is now the empty state. After: W1 pass.

### W10 · The refusal said `blocked` and then showed a JSON dump

*Content & Accessibility — "MUST: Design empty/sparse/dense/error states" and
"MUST: No dead ends; always offer next step/recovery".*

A user submits `https://example.com`, a host they do not own. The correct answer
is a refusal. What they read was the single lowercase word **`blocked`** over a
raw JSON object (before/receipt.json → W10, and the before screenshot). That is
a machine enum minted in `api/hosted/submit.js:35` and rendered verbatim as the
user-facing headline by `public/app.js`. The JSON underneath even contained the
way out — publish a `.well-known` file or a DNS TXT record — but nothing on
screen said so in a sentence. Filed in the defect ledger as **D1**.

**Fixed** in `public/app.js`: one function, `blockedMessage()`, is now the single
place a machine value becomes copy. The headline reads *"Blocked — nobody has
proved they own example.com yet, so ProofLoop will not point a browser at it. Do
either step in the receipt below, then ProofLoop again."* The receipt stays — it
is the point of journey J5 — but it is now evidence under a sentence rather than
the answer itself. After: W10 pass.

### W11 · Success and refusal were two shades of orange and nothing else

*Content & Accessibility — "MUST: Redundant status cues (not color-only); icons
have text labels".*

"Queued" was `#e59579`. "Blocked" was `#ffb199`. Two warm oranges, no icon, no
prefix, no other difference (before/receipt.json → W11: four kinds, **one**
distinct non-colour cue between them, i.e. none). In greyscale, in a screenshot,
or to roughly one man in twelve, the page's refusal looked exactly like its
success.

**Fixed** in `public/styles.css` and `public/app.js`: three cues now carry the
state — colour, a glyph (`⚠` / `✓` / `…`), and the leading word of the sentence
itself. After: 3 distinct non-colour cues; W11 pass.

### W13 · The GitHub link was a 38 px tap target on a phone

*Interactions › Targets & Input — "MUST: Hit target ≥24px (mobile ≥44px)".*

Measured in a real touch context at 386 px: input 48 px, button 48 px,
`Continue with GitHub` **38 px** (before/receipt.json → W13). Six pixels short of
the floor, on the only control that leaves the page.

**Fixed** in `public/styles.css`: `min-height: 44px`. After: 44 px, W13 pass.

### W17 · The receipt was a scrolling box no keyboard could reach

*Interactions › Keyboard — "MUST: Full keyboard support per
[WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/)".*

The refusal receipt renders into `<pre class="detail">`, which is `max-height:
220px; overflow: auto`. Measured in the refused state: **scrollHeight 284 px,
clientHeight 218 px, `tabIndex` −1, no accessible name** (before/receipt.json →
W17). Sixty-six pixels of the answer — including the second of the two ways to
prove domain ownership — existed only for someone with a mouse or a trackpad.

This is the finding that justifies the whole review existing next to the audit.
It sits one Tab press away from a rule axe implements (`scrollable-region-focusable`,
impact serious), and axe reported **0 violations** on this page, because axe
audits the page as loaded and this element is `hidden` until a submission is
refused. An automated pass that never opens the failure state cannot see the
failure state.

**Fixed** in `public/index.html` (`tabindex="0"` and `aria-label="Response
detail"`) and `public/styles.css` (the same 2 px focus ring, so the keyboard
user can see where they are). After: `tabIndex` 0, named, W17 pass.

## Moderate and minor findings

| # | Rule | Before | After |
|---|------|--------|-------|
| W3 | MUST: `touch-action: manipulation` to prevent double-tap zoom | `auto` on all three controls | `manipulation` — fixed |
| W4 | MUST: `autocomplete` + meaningful `name` | `name` absent (autofill and password managers had nothing to key on) | `name="target"` — fixed |
| W6 | MUST: Use `…` character (not `...`) | `"Submitting..."` | `"Submitting…"` — fixed |
| W8 | SHOULD: `<meta name="theme-color">` matches page background | absent | `#0b0b0d`, equal to `--bg` — fixed |
| W9 | MUST: Visible focus rings; NEVER `outline: none` without a visible replacement | `.github-sso:focus-visible` set `outline: 0` and replaced it with a 1 px border-colour change — the weakest of the three controls | same 2 px ring as the other two — fixed |
| W12 | MUST: Respect safe areas | no `env(safe-area-inset-*)` anywhere | `.landing` padded with all four insets — fixed |
| W15 | MUST: Errors inline next to fields; on submit, focus first error | submitting an empty input printed a message and left focus on the button | focus returns to the input — fixed |
| W16 | MUST: Loading buttons show spinner and keep original label | no spinner | **still open** — see below |

Two rules were already satisfied and are recorded so the next reviewer does not
re-derive them: W5 (input font-size 16 px, so iOS does not zoom on focus), W7
(`color-scheme: dark`), W14 (zoom not disabled), W2 (`<title>`).

## The one finding left open

**W16 — "MUST: Loading buttons show spinner and keep original label."** Half
holds: during the request the button keeps the label `ProofLoop` and disables
only *after* the request starts, and the status line reads `Submitting…` — all
three observed, not assumed, in
[`../browser-proof/receipt.json`](../browser-proof/receipt.json) →
`journeys.J5.pending`, with the screenshot
[`../browser-proof/j5-02-pending-1280.png`](../browser-proof/j5-02-pending-1280.png).
The missing half is the spinner itself.

It is left open deliberately rather than fixed in this pass: a spinner is the
page's first animation, and an animation needs its own `prefers-reduced-motion`
variant and a reason to exist (Animation — "MUST: Honor `prefers-reduced-motion`";
"SHOULD: Animate only to clarify cause/effect"). The pending state is already
announced in text through the live region W1 added, which is the part a spinner
cannot do. Recorded as **moderate, unresolved** — not silently downgraded, and
not counted as a pass.

Also noted and deliberately unchanged: the placeholder does not end with `…`
(Forms — "SHOULD: Placeholders end with `…`"). It shows two complete example
patterns; a trailing ellipsis there would imply truncation. Recorded in
`receipt.json` → W6 measurement as `placeholderHasEllipsis: false`.

## Verdict

**Condition 7: PASS — no major unresolved finding.** Five major findings were
found by this review, all five are fixed and re-measured, and the one remaining
failure (W16) is moderate and stated. Re-run with
`npm run build && npm run proofloop:wig-review`; it exits 1 if any major finding
returns.
