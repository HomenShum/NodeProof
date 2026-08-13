# Canonical journeys — NodeProof

Three to five real workflows. Not feature tours: a journey is one person, one
goal, and the artifact they hold when it worked. These are the promotion loop's
work queue, exercised in order of importance.

**A journey with no browser evidence is unfinished**, regardless of test status.

Under the `reduced` gate variant the surface being judged is what a stranger
actually meets: the quickstart (J1-J3, driven in a terminal) and the demo page
at `public/index.html` (J4-J5, driven in Chrome). Nothing is waived; the surface
is just smaller.

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J1 — "I cloned it. Does the thing even run?"

- **Persona and situation:** An engineer who saw the README's claim that a gate
  can refuse a coding agent's "done". Before wiring it into anything real, they
  want to know the repo is not a README with no code under it.
- **Goal:** A clean clone builds and its own test suite passes, on their machine,
  without credentials.
- **Steps:**
  1. `git clone https://github.com/HomenShum/NodeProof.git && cd NodeProof`
  2. `npm install`
  3. `npm test` (its `pretest` runs `npm run build` first: `tsc -p tsconfig.json && node scripts/build-site.mjs`)
- **Done when:** `npm test` exits 0 and prints a test count, having first
  produced `dist/cli.js` — the binary every other journey depends on.
- **Evidence:** [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md) §J1 — install 52 packages/11 s exit 0; build exit 0; `26 passed (26)` files, `145 passed (145)` tests, exit 0.

## J2 — "Make it refuse a lie" (the README's headline demo)

- **Persona and situation:** The same engineer, now suspicious of the actual
  claim. A gate that always says PASS is worthless. They want to watch it fail on
  a bug they planted, and pass only after they fix it.
- **Goal:** See exit code 1 while the code is wrong and exit code 0 after the
  one-line fix, with the verdict written somewhere they can read it later.
- **Steps:**
  1. In a throwaway project with `add(a,b) => a - b` and a test asserting `add(2,2) === 4`, run `proofloop init` (`src/init.ts` → `dist/cli.js init`).
  2. Run `proofloop gate` (`src/gate.ts`) with no `gate.checks` configured, and read what it says it is falling back to.
  3. Fix `add` to `a + b`.
  4. Run `proofloop gate` again.
  5. Run `proofloop resume --dense` to see what a returning agent would be told.
- **Done when:** Run 2 exits 1 and names the failing check; run 4 exits 0; both
  runs leave a verdict at `.proofloop/gate-state.json`, and `resume` reads that
  file back and states the next action.
- **Evidence:** [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md) §J2 — `check "npm test" FAILED (1831ms, exit 1)` → exit 1; after the fix `check "npm test" PASSED (1731ms, exit 0)` → exit 0; `resume --dense` prints `status=passed`.

## J3 — "Point it at this repo and tell me what is missing"

- **Persona and situation:** A reviewer deciding whether to trust the project's
  own maturity claims. They have no API keys and will not create accounts.
- **Goal:** Run the repo's advertised zero-key command and get an honest
  readiness report — including what NodeProof says is missing about itself.
- **Steps:**
  1. `npm run demo` — the command `nodekit.yaml` certifies as `noKey`, aliasing `proofloop doctor --json`.
  2. `npm run proof` — aliases `proofloop maturity --dense`, the command `nodekit.yaml` names as this repo's proof.
- **Done when:** Both exit 0 and the output contains named gaps rather than a
  blanket pass — `doctor` reporting `ready: false` with fix commands, `maturity`
  reporting a level with `partial` capabilities and `missing=` lines.
- **Evidence:** [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md) §J3 — `doctor` exit 0 with `"ready": false` and 3 `missing` entries; `maturity` exit 0 with `currentLevel=4`, `level=5 status=partial`, 2 `missing=` lines.

## J4 — "Here's my repo, give me the commands" (proofloop.live intake)

- **Persona and situation:** A developer who landed on proofloop.live from a
  link. They have a GitHub repo and no intention of reading a CLI manual first.
- **Goal:** Paste their repo URL into the one input on the page and leave with
  the exact command sequence to run against it.
- **Steps:**
  1. Open the landing page (`public/index.html`, served from `public/` per `vercel.json`).
  2. Type a repo into `[data-testid="target-input"]` — bare `owner/repo`, `github.com/...`, or a full URL; `normalizeTarget()` in `public/app.js` accepts all three.
  3. Click `[data-testid="target-submit"]`.
- **Done when:** The page shows a success status and a copyable command block
  containing `git clone`, `npx proofloop init --agent auto --live`,
  `npx proofloop maturity --target-level 5 --write`, `npx proofloop gate` — and
  crucially does *not* queue github.com itself for live-browser automation.
- **Evidence:** [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md) §J4 — Chrome DOM after the click: status "GitHub repo target ready." + the four-command block for `HomenShum/NodeProof`; screenshot `ss_5046tck1a`.

## J5 — "Prove it won't run against a site I don't own" (the receipt journey)

- **Persona and situation:** Someone evaluating the hosted service who wants to
  know what stops it from pointing a browser robot at any URL a stranger types.
- **Goal:** Submit a URL they do not control and see the request refused with a
  stated reason and a verifiable way to prove ownership — not silently queued.
- **Steps:**
  1. On the same landing page, enter `https://example.com`.
  2. Click ProofLoop. `public/app.js` POSTs to `/api/hosted/submit`.
  3. Read the status and the detail panel.
- **Done when:** The response is a refusal carrying the receipt of *why*: host,
  verification method, the exact `.well-known` file or DNS TXT token to publish,
  and the blockers list — produced by `verifiedHostAllowlist()` in
  `api/hosted/_shared.js`, not by the browser.
- **Evidence:** [evidence/baseline-2026-08-13.md](evidence/baseline-2026-08-13.md) §J5 — Chrome DOM: `{"status":"pending","host":"example.com","method":"well-known-token","token":"proofloop-domain-example-com-verify", "evidence":[...]}`; screenshot `ss_1809mprwv`. Also the defect D1 report: the headline word rendered above that JSON is the bare token `blocked`.

---

## Journeys every agent surface owes

NodeProof does not run an agent on the user's behalf — it supervises the agent
the user is already running, in the user's own terminal. That changes which of
these three apply:

- **Recovery** — applies, and is folded into J2 step 5. The recovery surface is
  `proofloop resume`, which reads `.proofloop/gate-state.json` after a crashed or
  abandoned session and prints the next action, so a fresh agent resumes cold
  without the previous transcript. (`proofloop runner resume --clear-stale-lock`
  is the deeper form and is **not** covered by any journey here — untested.)
- **Steering** — does not apply as a user-facing journey, and that is the
  product's central design decision rather than a gap. The user does not steer a
  NodeProof run mid-flight; they steer their own coding agent, and NodeProof's
  contribution is to refuse the agent's exit. The nearest thing to steering is
  editing `proofloop.config.json`, which becomes a protected path the moment
  hooks are installed — deliberately not the agent's to move.
- **Receipt** — applies, and is J5. Every consequential action leaves a file the
  user can read afterwards: `.proofloop/gate-state.json` for a gate verdict, the
  permission/domain-verification packet for a hosted submission.
