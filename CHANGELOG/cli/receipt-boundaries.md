# Local program and receipt boundaries

A developer handing local proof work to an agent needs failed evidence to stop dependent
work, even when the receipt is well formed. This port retains PR #23's program supervisor,
envelope schema, Ease verifier, fixtures, and legacy NodeKit binding on current main.

- Program envelope hooks now require an authoritative passing verdict; generic inspection
  still accepts valid failed, blocked, error, advisory, and informational evidence.
- Required NodeKit gates accept only `passed: true` or an explicitly configured status alias.
  Demo's deliberate `requirePassed: false` contract remains intact. Current canonical NodeKit
  browser-contract/browser-certification outputs are explicitly **NOT_SUPPORTED**.
- Ease integrity errors clear certification. Metadata rejected by the envelope validator returns a
  failed result without writing an envelope whose payload hash could become stale.
- One private descriptor reader reuses transfer-check's regular-file and 10MiB boundary.
  Protected receipt references also reject escaping paths, symbolic links, and junctions.
  Media, replay files, and archives above 10MiB are unsupported and rejected.

## Verification

Recorded local proof on 2026-10-08 uses current main `7135fd6` plus the original feature
baseline, the existing 51-package graph, and unchanged strict build/native test policy.

- Baseline and candidate strict TypeScript builds and native stamp hooks exited 0.
- The same 27 desired scenarios changed from **11 passed / 16 failed** in the baseline to
  **27 passed / 0 failed** in the candidate full suite. All 11 baseline passes were retained.
- The candidate default suite discovered **348 tests across 35 files**: **338 passed /
  10 failed**, with no pending or skipped tests. Its native exit code was 1. All ten failures
  were stale walkthrough/CodeTour CLI line anchors; this is not an all-pass result.
- The 12-child CLI burst and one 60-second paced recovery assertion passed on both sides.
  The JSON reporter omitted console RSS/recovery-point observations, so no numeric memory
  or sustained-resource improvement is claimed.

The baseline report SHA-256 is `C231799095971D33ADC939544D396B39E2A44C5C24023918167080246AED9B2A`;
the candidate report SHA-256 is `21E8015566EED01E5B610DA3124DEE0B575F7D98C41B9CDE6012793951CFAC47`.
Source/runtime bindings and primary checkout remained unchanged. This entry records the
run before the proposed anchor corrections; a new observed result must precede any green
claim. No remote CI, deployment, usability, or live provider pass is claimed.

## 2026-10-08: required-gate correction and final local result

A release engineer deciding whether dependent work may proceed now gets a failed required
live or deployment gate when the supplied receipt says `passed: false`, even if it also says
`status: "pass"`. The configured status alias is accepted only when `passed` is absent;
`passed: true` and Demo's `requirePassed: false` behavior remain unchanged.

- The two new contradiction cases first failed against the unchanged verifier, both because
  the gate returned success. The other 27 scenarios were filtered in that selected before run.
  Both identical cases passed after the one-condition correction, inside the full native suite.
- A fresh strict TypeScript compile and native build stamp each exited 0. The only changed
  generated file was `dist/nodekitProof.js`; the remaining 71 compiled files and stamp bytes
  were unchanged.
- The final default native suite passed **350 tests across 35 files**, with **0 failed,
  pending, or skipped tests** and native exit 0. All **29 receipt scenarios** and all
  **116 walkthrough assertions** passed.
- The preceding **338 passed / 10 failed out of 348** result above remains historical evidence.
  All 348 cases were retained: 341 kept their exact names and seven citation titles changed
  only their approved CLI line numbers. Those ten anchor failures now pass; two new required
  gate cases account for the increase to 350.
- The original matched 27 scenarios remain **11 passed / 16 failed** before the boundary
  corrections and **27 passed / 0 failed** afterward. The 12-child burst and one 60-second
  paced recovery assertion passed in the final run.

The selected contradiction-before report SHA-256 is
`B271C49146747C035D0455C454254F1DD026F75999708E14F76B4B8869B86919`;
the final full-suite report SHA-256 is
`686EEAF59CEF426A8B3B07B732D2EF4E475AC9594F9EC5C960E608F5AE5E3A11`.
The final proof retained the fixed source/runtime graph and all 72 compiled output hashes
through the test run. This is local Windows/Node 22 evidence on main `7135fd6` plus the
selected port, not remote Linux/Node 20 CI, publication, or production certification.
The reporter still omitted numeric RSS observations. Current canonical NodeKit outputs
remain unsupported, and no complete JSON Schema, hostile filesystem-race, or runtime
sandbox guarantee is added.
