# Proof Loop Interoperability

Proof Loop stays the certification source of truth: deterministic gate receipts, tool-use logs, and runner receipts decide pass/fail. External orchestration and observability systems can mirror or launch work, but they do not replace Proof Loop receipts.

## LangChain and LangSmith

Use LangChain as an adapter boundary, not as the proof harness. A LangChain agent may call the product or tooling under test, but Proof Loop should still run the final `npx proofloop gate` or `npx proofloop runner run --plan ...` command and record the result under `.proofloop/`.

Recommended receipt fields when mirroring a run into LangSmith:

- `traceId`
- `proofloopRunId`
- `gateStatePath`
- `runnerStatePath`
- `toolCallId`
- `modelRoute`
- `tokens`
- `costUsd`
- `latencyMs`
- `stopReason`

LangSmith export failures are telemetry failures. They must not fail a Proof Loop certification run unless the run's own gate explicitly requires the export.

## Harbor

Harbor remains the isolated benchmark lane for official benchmark claims. Product-path Proof Loop gates can pass independently, but official-score claims should point to Harbor/Gandalf-style receipts or a recorded equivalent judge contract.

Keep the split explicit:

- Product proof: `npx proofloop gate`, `.proofloop/gate-state.json`, local UI/user-workflow evidence.
- Proxy benchmark proof: `npx proofloop runner run --plan ...`, runner state and ledger.
- Official benchmark proof: upstream scorer output imported as a receipt, with candidate output produced before evaluator access.

## Provider Routes

For provider setup, use:

```bash
npx proofloop providers setup all
npx proofloop providers setup nebius
```

The command writes `.proofloop/setup/providers/<provider>.json` receipts for Butterbase, Neo4j, RocketRide, Daytona, Cognee, and Nebius. Missing credentials are recorded as `needs_credentials`; they are not treated as passing setup.

## Agent Adapters

Use:

```bash
npx proofloop agents list
npx proofloop agents setup codex --local
npx proofloop agents setup claude-code --local
npx proofloop codex-loop --dry-run
```

Codex and Claude Code can install hook enforcement now. Cursor, Windsurf, Devin, and generic CLI hosts are represented as adapter receipts until a launch, trace-capture, and gate-enforcement surface is configured.
