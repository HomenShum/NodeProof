# world.md

ProofLoop's world model describes proof reality, not application business logic.

```ts
type ProofWorld = {
  target: Repo | LiveUrl | HybridTarget;
  claims: Claim[];
  gates: Gate[];
  receipts: Receipt[];
  tools: ToolAffordance[];
  budgets: Budget[];
  permissions: Permission[];
  blockers: Blocker[];
  risks: Risk[];
  reports: ContextReport[];
};
```

## Core Entities

- Target: the codebase, live URL, or both.
- Claim: a statement someone wants to make, such as "live browser verified" or "official score ready".
- Receipt: machine-readable proof produced by a gate, runner, browser test, scorer, or tool-use contract.
- Blocker: a known missing adapter, missing scorer, failing check, missing permission, or exhausted budget.
- Report: dated Markdown snapshot that a human or agent can read.

