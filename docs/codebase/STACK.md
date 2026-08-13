# Stack

What is installed, what it is for, and what is deliberately absent.

## Runtime

| Thing | Version | Where it is declared |
|---|---|---|
| Node | `>=20` (developed on 22) | `package.json` → `engines` |
| Language | TypeScript 5.7, compiled to CommonJS, target ES2022 | `tsconfig.json` |
| Package name | `proofloop` (repository is `NodeProof`) | `package.json` → `name` |

## Dependencies

**Runtime dependencies: zero.** Not "few" — none. `package.json` has no
`dependencies` block at all. Everything the shipped tool does uses `node:fs`,
`node:path`, `node:child_process`, `node:crypto`, `node:dns`. This is a product
promise, not an accident: the tool installs into somebody else's repository and
runs inside their coding agent's hook, where a dependency tree is a liability.
If you are about to add a runtime dependency, that promise is what you are
spending.

Four development dependencies, all of them tools rather than libraries:

| Package | Why it is here | What breaks without it |
|---|---|---|
| `typescript` | compiles `src/` → `dist/` | `npm run build` |
| `vitest` | the test runner | `npm test` |
| `@types/node` | types for the standard library | typecheck |
| `playwright` | drives Chromium for the landing-page proof | `npm run proofloop:browser-proof`, `scripts/hosted-worker.mjs` |

## Deliberately absent

- **No YAML parser.** Tool-use contracts are JSON, stated as a decision in the
  header of `src/proofloopToolUse.ts` — "zero new npm deps".
- **No web framework, no bundler, no CSS framework.** `public/` is three files
  served as-is: `index.html`, `app.js`, `styles.css`.
- **No test framework beyond vitest**, no mocking library. Tests write real
  files into temporary directories and read them back.
- **No linter or formatter config.** Style is held by review and by
  `tsconfig.json`'s strict flags (`strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`), which do fail the build.
- **No bundler for the site.** There used to be one, for an in-browser demo that
  nothing loaded; it was deleted in this pass. See `docs/SIMPLIFICATION_REPORT.md`.

## Hosting

- **Vercel**, configured by `vercel.json`: `buildCommand: npm run build`,
  `outputDirectory: public`, `cleanUrls: true`, plus four security headers.
- `api/**/*.js` are **Vercel serverless functions** — plain CommonJS
  `module.exports = async function handler(req, res)`, no framework. They are
  *not* compiled from `src/`; they are hand-written JavaScript that `require()`s
  the compiled `dist/`. `docs/codebase/ARCHITECTURE.md` explains that seam.
- **GitHub Actions**: `.github/workflows/ci.yml` (build, test, gate, CLI smoke)
  and `hosted-proofloop.yml` (the hosted worker, triggered by
  `workflow_dispatch`).

## Commands

```bash
npm install                     # 51 packages
npm run build                   # tsc -> dist/
npm test                        # pretest builds first; vitest run
npm run demo                    # proofloop doctor --json   (no keys, no accounts)
npm run proof                   # proofloop maturity --dense
npm run proofloop:gate          # the gate, against this repo
npm run proofloop:browser-proof # Chromium proof of the landing page
node dist/cli.js help           # every command
```
