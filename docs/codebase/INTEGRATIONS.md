# Integrations

Everything this codebase talks to that is not itself, what it needs to work, and
what happens when it is absent. **Nothing here is required to run the CLI or the
test suite** — the primary surface has zero external dependencies by design.

## Summary

| Integration | Needed for | Absent behaviour |
|---|---|---|
| A coding agent CLI (Codex, Claude Code, …) | `codex-loop`, `agents setup` | reports `needs_command`; nothing is launched |
| Vercel | the deployed landing page | irrelevant locally; the page is static files |
| GitHub OAuth | "Continue with GitHub" on the page | redirects to `/?auth=github_unconfigured` |
| GitHub Actions API | dispatching a hosted proof run | `503` with `status: "dispatch_failed"` |
| DNS / HTTPS to the target host | proving domain ownership | permission stays `pending`; the run is refused |
| Playwright + Chromium | the browser proof | the two scripts that import it say so and exit |
| Ed25519 keys | signing trust receipts | `solo attest` exits 2 with the missing variable named |

## 1. Coding agents

**Where:** `src/agentAdapters.ts` — six adapters (`codex`, `claude-code`,
`cursor`, `windsurf`, `devin`, `generic-cli`).

An adapter knows two things: where that agent's settings file lives, and how to
launch it with a prompt file. Detection is `which`-style PATH lookup in
`src/detect.ts`. Launching uses `spawnSync`; when the binary is not there the
result is `status: "needs_command"` — **explicitly not** a silent success, which
would be indistinguishable from a passing run.

## 2. Vercel — hosting the landing page

**Where:** `vercel.json`, `public/`, `api/**`.

- `buildCommand: npm run build`, `outputDirectory: public`, `cleanUrls: true`.
- `api/**/*.js` become serverless functions by file path. They are plain
  CommonJS `module.exports = async function handler(req, res)` — no framework —
  and they `require()` the compiled `dist/`.
- Four response headers are set for every path: `X-Content-Type-Options`,
  `Referrer-Policy`, and `Cross-Origin-Embedder-Policy: require-corp` /
  `Cross-Origin-Opener-Policy: same-origin`. The last two were added for an
  in-browser demo that has since been deleted; they are harmless (the page loads
  no cross-origin resources) and were left in place rather than changing
  deployed headers during a structural pass. See `docs/codebase/CONCERNS.md`.

**Running the page locally:** there is no `vercel dev` requirement.
`scripts/browser-proof.mjs` serves `public/` and mounts the real `api/**`
handlers with Vercel's own routing rules, on an explicit port:

```bash
npm run proofloop:browser-proof            # default port
node scripts/browser-proof.mjs --port 4311 # if that port is taken
```

It **exits 2 rather than reusing a port that is already in use**, so it can
never measure somebody else's dev server.

## 3. GitHub OAuth — "Continue with GitHub"

**Where:** `api/auth/github/{start,callback,status}.js`, shared in `_shared.js`.

| Variable | Fallback | Purpose |
|---|---|---|
| `PROOFLOOP_GITHUB_OAUTH_CLIENT_ID` | `GITHUB_CLIENT_ID` | OAuth app id |
| `PROOFLOOP_GITHUB_OAUTH_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` | OAuth app secret |
| `PROOFLOOP_AUTH_COOKIE_SECRET` | `PROOFLOOP_GITHUB_OAUTH_COOKIE_SECRET`, then the client secret | signs the session cookie |
| `PROOFLOOP_GITHUB_OAUTH_SCOPE` | `read:user user:email` | requested scope |

`githubAuthConfig()` returns `configured: false` unless id, secret and cookie
secret are all present, and `start.js` then redirects to
`/?auth=github_unconfigured` — an unconfigured deployment shows a message rather
than a stack trace. CSRF is a signed `state` cookie with a 10-minute lifetime;
sessions last 7 days.

## 4. GitHub Actions — dispatching a hosted run

**Where:** `api/hosted/_shared.js` → `dispatchHostedWorkflow`, targeting
`.github/workflows/hosted-proofloop.yml` via `workflow_dispatch`.

| Variable | Default | Note |
|---|---|---|
| `PROOFLOOP_GITHUB_TOKEN` | — | required; without it dispatch fails |
| `PROOFLOOP_GITHUB_OWNER` | `HomenShum` | |
| `PROOFLOOP_GITHUB_REPO` | `proofloop` | **stale**: the repository is now `NodeProof`. GitHub redirects renamed repositories on most API paths, so this may be harmless; confirming it needs a live token. Recorded in `promotion/PROMOTION_LOG.md` as an observation, not a defect. |
| `PROOFLOOP_HOSTED_WORKFLOW` | `hosted-proofloop.yml` | |

Failure is honest: `503` with `status: "dispatch_failed"` and the dispatch
detail. There is no success-shaped response on a failed dispatch.

## 5. Domain ownership — the network half of the trust boundary

**Where:** `verifiedHostAllowlist` (`api/hosted/_shared.js:72`), calling
`wellKnownHasToken` (`:92`) and `dnsHasToken` (`:111`).

Before any automation is pointed at a URL the requester must prove they control
the host, by either:

- serving `https://<host>/.well-known/proofloop-domain-verification.txt`
  containing the token, or
- publishing a DNS TXT record at `_proofloop.<host>` with the same token.

Neither present → `400` with the host, the method, the exact token, and the
blockers. The token is derived from the host, so it is stable across attempts
and a user can act on the refusal without asking anyone.

## 6. Playwright

Declared in `devDependencies` and imported by `scripts/browser-proof.mjs` and
`scripts/hosted-worker.mjs`. The browser binary is separate:
`npx playwright install chromium`. Both scripts report the missing dependency
rather than failing obscurely.

## 7. Signing — trust receipts

**Where:** `src/soloTrust.ts`, Ed25519 through `node:crypto` (no library).

`PROOFLOOP_TRUST_PRIVATE_KEY_PEM` signs; `PROOFLOOP_TRUST_PUBLIC_KEY_PEM` (or
`--public-key-file`) verifies. Missing keys are exit 2 with the variable named.
Keys are never read from the repository and never written into `.solo` — there
is an explicit refusal for that in `src/cli.ts` (`resolvesInsideSolo`).

## What is *not* integrated

No database. No telemetry, analytics, or crash reporting. No LLM API — the
verdict path contains no model, which is the product's core claim. `providers
setup` writes *setup receipts* for optional external services; it does not call
them as part of any proof.
