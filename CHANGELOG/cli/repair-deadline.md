# Repair deadline — 2026-10-14

A developer allowing one coding-agent repair still needs that repair to finish
or report failure. Previously the shell launch used `spawnSync` without a
timeout: a finite four-second local repair blocked a caller's 100 ms timer for
4,092 ms and delayed the repair receipt until it returned. Launch count alone
did not control elapsed time.

The existing launcher is now asynchronous, with a validated per-repair deadline
(default 30 minutes), standard `AbortSignal`, bounded process cleanup and 1 MiB
per output stream. The loop, Promise facade and direct CLI relaunch await it.
Timeout/cancellation remains failure even if the process later exits zero;
unverified cleanup stops automation with an explicit diagnostic. Failed or
cancelled repairs do not trigger another repair or verifier.

Version 0.4.0 records the intentional public return-type break:
`launchProofloopAgentAdapter(...)` now needs `await` and rejects malformed
deadline values. See START_HERE for awaited try/catch migration. No second
synchronous launcher, dependency upgrade or npm publication is included.

The deadline excludes synchronous gates and is followed by a fixed cleanup
allowance (Windows up to 4 seconds, POSIX up to 2 seconds). Normal foreground
completion does not establish that arbitrary detached or reparented jobs ended.
Windows console interruption and the POSIX process cases need their own real
platform evidence; one platform does not certify another. The Windows Node
inherited-pipe fixture failed to establish its pipe-retention precondition, so
it is explicitly unproved there. Existing log/receipt overwrite behavior and
whole-loop budgets remain unchanged.

Validation uses real, finite local processes, actual generated prompts, failed
and passing project gates, cancellation, output/persistence failures, a
three-job burst and twelve isolated sequential jobs. The original synchronous
scenario fails causally before the fix. Raw failures, including a loaded
Windows helper timeout, are retained privately; the helper allowance is bounded
and unverified cleanup never becomes permission to continue. No provider/model
call, visual change, live deployment or completed Linux proof is claimed by
local Windows results. Exact-head Linux Node20 CI remains a release gate.
