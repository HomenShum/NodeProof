# harness.md

The harness is the part that reality-checks agent work.

## Harness Pieces

- `proofloop gate`: deterministic completion gate.
- `proofloop target`: target scan, benchmark matching, runner-plan discovery, and context report generation.
- `proofloop runner`: durable command execution with ledger, locks, budget, resume, and secret redaction.
- `proofloop hooks`: stop gate and protected path guards.
- `proofloop tooluse`: expected tool-use contracts.
- `proofloop receipt verify`: app-produced receipt verification.

Harness tasks must terminate. Dev servers, watch mode, preview servers, and interactive prompts are not proof tasks.

