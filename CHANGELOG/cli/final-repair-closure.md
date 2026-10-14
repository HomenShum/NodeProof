# 2026-10-14 — Verify the last permitted repair

A developer permits one coding-agent repair of a project whose API and export
checks fail. Previously, even a successful repair returned `needs-repair`:
the supervisor checked only before launching the agent and then exhausted its
loop. With two allowed repairs, the same error affected the second repair.

The supervisor now checks initially and after each successfully completed
repair, including the final one. A false success claim or partial repair stays
failed after fresh checks. No extra agent is launched after the budget ends.
This fixes the shared API and the `proofloop codex-loop` command; tracked
compiled CLI/runtime files contain the same change.

`maxAttempts` / `--max-attempts` must be a positive safe integer (default one).
Invalid supplied values now fail before running checks or writing artifacts,
instead of being coerced or silently replaced with one. `attempts` now counts
actual launches: initially green, dry-run and missing-command outcomes report
zero; a launched command that fails counts once. Consumers relying on the old
gate-round count must use the `gate-attempt-N.json` observation files instead.
There can be one more gate observation than repair launches.

Verification uses real finite local Node processes with independent API and
export checks: final/early repair success, no-op claims, partial repairs,
process failure, missing command/gate, malformed API/CLI budgets, three
simultaneous isolated CLI jobs and twelve successive jobs in one project.
The new success scenarios fail on the prior implementation at stale failure
and incorrect launch-count assertions. No paid provider or model evaluation is
involved; these checks measure supervisor behavior, not reasoning quality.

Existing limits remain: agent launches lack a wall-clock timeout; adapter logs
and the latest repair receipt overwrite across attempts; concurrent jobs need
isolated roots and distinct run IDs. This patch does not certify indefinite
unattended execution or append-only internal repair history.
