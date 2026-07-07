# failure-modes.md

Known failure modes:

- Claiming done from transcript text.
- Editing `.proofloop/gate-state.json` to forge a pass.
- Weakening `proofloop.config.json`.
- Removing CI gate workflows.
- Treating a browser smoke test as an official benchmark score.
- Treating proxy proof as official score proof.
- Certifying an empty tool-use log.
- Hiding blocked adapters behind a green summary.
- Emitting non-terminating watch tasks into a runner plan.

The fix is not better wording. The fix is a gate, guard, receipt, test, or blocker.

