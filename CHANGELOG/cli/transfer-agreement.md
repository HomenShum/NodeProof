# Transfer agreement

## 2026-10-07 — canonical adoption verified

[PR #27](https://github.com/HomenShum/NodeProof/pull/27) is adopted at main
`75325e5273e5f90f612a9f59c3019d8f49671df1`; PR #9 is closed unmerged with its
original head and branch preserved. All 250 canonical leaves match the reviewed
tree: 22 adopted paths and 228 unchanged original leaves. Configured Node 20.20.2
[main CI](https://github.com/HomenShum/NodeProof/actions/runs/37731756102),
platform conformance and production identity verification passed. A separate
bounded raw-HTML read of `https://proofloop.live/` returned 200 with exactly one
`proofloop-build-sha` equal to that main commit. This verifies the static build's
identity; CLI behavior is covered by the build, 291-test runs and package checks
below. npm registry publication and live-agent/browser provenance are unverified.

## 2026-10-07 — current-source port, publication pending

A developer or coding agent comparing two supplied verdict files can now use
`node dist/cli.js transfer-check sample|gate`. A headless pass paired with a
browser-labelled failure is reported as a disagreement to investigate. The
command compares the supplied rows; it cannot establish live execution,
production-browser provenance, or whether the browser rows follow the sampler.

- Ported PR #9's typed readers, FNV-1a/xorshift sampling, failure strata,
  task/model joining, threshold/epsilon, disagreement labels and 0/1/2 exits
  onto canonical `e436b6b1aa4380bcaebe87af31800b509891a06b`. The old PR head
  `eea0bea3f9b19087474fcd311d3941f474b43bdc` and branch remain preserved.
- Corrected the successful claim to agreement of supplied rows, with provenance
  and seeded selection `NOT_VERIFIED`. The explicit no-failure-overlap warning
  is unchanged; agreement is computed rather than a calibrated confidence score.
- Admit only regular files up to 10 MiB, before parsing. Descriptor reads stop
  at MAX+1, detect growth beyond the limit and close in `finally`; oversized
  input exits 2 before any sample output write. Pure-function callers must
  bound their own arrays. No dependency, runtime route or gate change.
- Local comparison uses Windows Node 22.22.2/npm 10.9.7 and the same existing
  51-record installed graph/current lock, without installation. Canonical
  strict build and 268/268 tests passed; the runnable original feature built
  and passed all 16 original scenarios. The frozen final 22-scenario suite
  against that original implementation produced 16 passes/6 assertion failures:
  unsupported certification wording and accepted oversized input, including
  burst/sustained observations. It had no runner/import error or skipped case.
- Independent review reproduced an inherited NUL-delimiter collision: five
  distinct cross-lane task/model tuples falsely agreed; two distinct tuples
  within one lane were also rejected as duplicates. The shared owner now uses
  `JSON.stringify([taskId, model])`, preserving ordinary pair behavior without
  a new hashing framework. One real-file scenario covers false overlap,
  distinct pairs and genuine duplicates. Missing-seed messages now recommend
  an auditable seed while explicitly denying prevention of re-rolling.
- The intermediate full suite passed 290/290 before those final wording/key
  corrections; this is a historical source snapshot. The final strict build
  passed and the full suite passed 291/291 across 30 files, including all 22
  retained transfer cases plus the real-file collision case. False cross-lane
  overlap exits 2, distinct tuples sample successfully, and genuine duplicates
  still exit 2. The 12-job burst returned the expected 0/1/2 outcomes; the
  60.564-second observation completed 52 iterations/104 successful child calls,
  rejected oversized input with exit 2, recovered and left no owned children.
- Help, controlled-profile doctor and prompt commands exited 0. Doctor reports
  `ready: false` where coding-agent prerequisites are absent; its exit does not
  certify those prerequisites. After the 291-test run, one test title was
  corrected to deny guaranteed sample selection. The exact title-only follow-up
  passed that case, with 22 filtered cases; no assertions or production bytes
  changed. Automatic configured Node 20 CI and canonical publication remain
  pending; no production, browser-pixel, native Linux FIFO, universal
  locale determinism, memory/performance SLA or all-gap completion is claimed.
- Root independently reran the final source, including the corrected test title:
  291/291 tests passed across 30 files, with all 23 transfer cases. The sustained
  observation completed 52 iterations/104 calls over 60.715 seconds, recovered
  after rejecting oversized input and left no owned children.
- The README links this changelog. A normal offline npm pack dry run exposed
  its omission from the package; the existing `files` list now includes
  `CHANGELOG`. Dependencies, lock, scripts and lifecycle hooks are unchanged.

Proof: `NODEPROOF-TRANSFER-AGREEMENT-01` external raw commands, source bindings
and matched scenario source. The initial controlled-runner forwardslash
`ComSpec` observations were confounded and preserved. An initial desired run
also had an invalid JSON reporter output path and one over-specific native
special-file message assertion; it is historical, not the final comparison.
The matched original-feature 22-scenario file is SHA256
`6EE2F9AD5BFD876AA443A081B2D7E9318D6564D6DCBCA347CD31317D5B93791E`.
The final full-suite transfer file was
`9D6AE2270A1914E4FDAC3E131398A3C6257975343AEF5EBE7EA29862899190D0`;
the final source after the test-title-only correction is
`A520D3BF181051EBE20AEB246C115206BBDC4E7F83D35017A09D64BB11EB79EA`.
Transfer scenarios use synthetic local rows and owned subprocesses. The full
existing suite additionally permits bounded, unauthenticated example.com
well-known/DNS reads; no provider, paid action or GitHub dispatch was enabled.
