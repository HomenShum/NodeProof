# readiness.md

ProofLoop readiness means the proof story is complete enough to state honestly.

Checklist:

- `npx proofloop doctor --json` has no unhandled setup blockers.
- `npx proofloop target --write-runner-plan` wrote a target plan and context report.
- All generated runner tasks terminate.
- `npx proofloop gate` passes or the runner report shows passed.
- Browser claims have browser receipts.
- Official benchmark claims have official scorer outputs or an explicitly recorded equivalent judge contract.
- Remaining blockers are listed in the latest context report.

If any item is missing, say what is not done.

