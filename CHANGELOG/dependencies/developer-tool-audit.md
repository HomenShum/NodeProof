# 2026-10-14 — Audit the tools coding agents actually execute

A developer or coding agent could receive green CI while the test toolchain
contained five affected packages. `npm ci` printed the advisories without
failing, and `npm run check` audited only production dependencies—which this
CLI does not have.

Update eleven locked package records: Vitest and its seven coupled packages
from 4.1.9 to 4.1.11; PostCSS 8.5.16 to 8.5.30; Nano ID 3.3.15 to 3.3.20; and
source-map-js 1.2.1 to 1.2.2. The manifest declares the patched Vitest minimum.
Other locked packages, including Vite 8.1.3, stay unchanged. No runtime
dependency, app code or test assertion changes.

Both `npm run check` and an explicit CI step now use full `npm audit`, so
development advisories cause failure instead of an apparently clean result.
No advisory suppression, override or force resolution is introduced.

Before: full audit exited 1 with five affected packages (two moderate, three
high), representing six advisories. After: a clean locked install and full
audit pass with zero reported findings. The existing 364 scenario tests,
compiler output and Node 20 CI provide behavior and compatibility checks.
This is evidence about the known dependency graph, not a claim that all
possible vulnerabilities are absent.

Primary fixes: [Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9),
[Nano ID negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)
and [zero size](https://github.com/advisories/GHSA-2v37-7h3g-55p8),
[PostCSS source maps](https://github.com/advisories/GHSA-r28c-9q8g-f849)
and [follow-up fix](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Vitest 4.1.11 is the patched supported line for the existing Node 20 tests;
it is not the globally latest release. Vitest 5.0.4 modernization remains
open and requires newer development Node/type peers plus explicit Node 20
consumer proof. See the [migration requirements](https://vitest.dev/guide/migration/).
The CLI's Node >=20 contract and zero-runtime-dependency promise remain.
