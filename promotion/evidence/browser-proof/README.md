# Browser proof — retained output

Everything in this directory was produced by **`npm run proofloop:browser-proof`**
(`scripts/browser-proof.mjs`), which is committed and runs from a fresh clone
with no credentials:

```
git clone https://github.com/HomenShum/NodeProof.git && cd NodeProof
npm ci
npx playwright install chromium      # browsers only; the package itself is a devDependency
npm run build                        # api/** handlers require dist/hosted.js
npm run proofloop:browser-proof      # exits 0 only when every check below holds
```

This exists because the Wave 1 baseline measured the landing page through a
throwaway harness and a browser session that died with it. The numbers were
true; nobody could re-open them. Five scorecard rows were downgraded to
UNVERIFIED for that reason alone. This directory is the missing half.

## What the probe does

It starts a local server on **127.0.0.1:4310** that serves `public/` and mounts
the repo's own `api/**/*.js` handlers unchanged — the same routing Vercel applies
(`cleanUrls: true`, so `/api/hosted/submit` resolves `api/hosted/submit.js`). It
refuses to run if the port is already bound, because a probe that silently
measures somebody else's dev server proves nothing. Then it drives Chromium
through journeys J4 and J5 and writes `receipt.json` plus the screenshots here.

## This run

- Captured `2026-08-13T11:50:43Z`, Node v22.22.2, Playwright 1.62.1, Windows 11.
- Served on `http://127.0.0.1:4311` — **not** the 4310 default. Port 4310 was
  held by an unrelated local server, the probe refused to continue, and the run
  was repeated with `--port 4311`. The receipt records the port actually used.
- Verdict: `"pass": true`, `"failures": []`.

| Artifact | What it shows |
|----------|---------------|
| `receipt.json` | Machine-readable verdict: journeys, layout table, timings, console, every response status, open defects. |
| `j4-01-empty-1280.png` | First load. The status line starts hidden — the designed empty state. |
| `j4-02-repo-ready-1280.png` | J4 done: "GitHub repo target ready." above the four-command block. |
| `j5-01-refused-1280.png` | J5 done: the refusal receipt with host, method, `.well-known` token and blockers. Also shows defect D1 — the headline is the bare word `blocked`. |
| `layout-0316px.png` … `layout-2560px.png` | Six widths, each measured with the J5 refusal JSON rendered (the widest content the page ever holds). |

## Measured, not read off the CSS

| Width | scrollWidth − clientWidth | intake columns | submit button | `h1` |
|-------|---------------------------|----------------|---------------|------|
| 316 | 0 | 1 | 274 px | 32 px |
| 386 | 0 | 1 | 344 px | 32 px |
| 620 | 0 | 1 | 578 px | 50 px |
| 768 | 0 | 2 | 117 px | 61 px |
| 1280 | 0 | 2 | 117 px | 76 px |
| 2560 | 0 | 2 | 117 px | 76 px |

Timings on first load: `domContentLoaded` 206 ms, `load` 206 ms, 9 874 B
same-origin transfer. Click-to-status latency on J5 (the network path): 211 ms.

## The one non-2xx, and why it is not a failure

`POST /api/hosted/submit -> 400`. That is J5 succeeding: the page asked to run a
browser robot against a host the caller has not proven they own, and the API
refused with the verification receipt attached. Chromium echoes every non-2xx
fetch into the console as "Failed to load resource", so the *same* refusal shows
up twice. The probe explains it in both places — matched on URL **and** status,
so any other path or any other status still fails the run — and ships both lists
in the receipt under `console.explainedErrors` and `console.unexplainedErrors`.

## Defects the probe sees and does not fix

`receipt.json` → `openDefects`. Recorded rather than fixed so that a later fix
flips a field a reader can diff:

- **D1** — `public/app.js:127` renders the machine enum `blocked` as the
  user-facing headline. Visible in `j5-01-refused-1280.png`.
- **D2** — `[data-intake-status]` carries no `role="status"` / `aria-live`, so
  the page's only dynamic output is announced to nobody.
