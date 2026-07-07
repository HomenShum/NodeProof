# context.md

Context is scarce. ProofLoop gives agents compact state instead of full transcripts.

## Include

- Current user goal.
- Latest target report.
- Gate status and failing checks.
- Target recommendations and blockers.
- Runner state and ledger path.
- Stable UI contracts.
- Permission and budget limits.

## Exclude

- Raw long logs unless debugging a specific failure.
- Stale reports when a newer target report exists.
- Worker self-reports that lack receipts.

