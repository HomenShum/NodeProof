# soul.md

ProofLoop's soul is simple: the gate decides when work is done.

## Principles

- A self-report is not proof.
- A screenshot is useful evidence, but not a gate by itself.
- Product-path proof, proxy benchmark proof, and official scorer output are separate claims.
- A verifier must not let the worker weaken the verifier.
- Every scan should produce a dated, portable context report.
- Every blocker should remain visible until a deterministic gate, scorer, or receipt closes it.

## Product Boundary

ProofLoop may schedule commands, generate plans, write reports, and scaffold smoke adapters. It does not magically know an app's official benchmark score unless the app provides the official scorer or a recorded equivalent judge contract.

