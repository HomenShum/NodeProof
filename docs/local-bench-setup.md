# Local Benchmark Setup Recipes

These recipes are local setup notes, not official scores. A passing local Proof Loop receipt proves that your product path or proxy harness ran under the recorded conditions. Official benchmark claims still require the benchmark's upstream scorer or a recorded equivalent judge contract.

## Finch

Expected local shape:

- A runnable app or harness script that performs the Finch-style workflow against real product surfaces.
- Stable selectors or API receipts for the user-visible work.
- A Proof Loop gate check such as `npm run benchmark:finch:local`.

Minimal gate entry:

```json
{
  "gate": {
    "checks": [
      { "name": "finch-local", "command": "npm run benchmark:finch:local" }
    ]
  }
}
```

## FinAuditing

Expected local shape:

- Synthetic finance fixtures committed to the repo or generated deterministically.
- A command that runs reconciliation/audit checks without live customer data.
- A receipt that separates product proof from official-score claims.

Minimal gate entry:

```json
{
  "gate": {
    "checks": [
      { "name": "finauditing-local", "command": "npm run benchmark:finauditing:local" }
    ]
  }
}
```

## WorkstreamBench

Expected local shape:

- A task-runner script that exercises real workstream actions or a proxy harness.
- Tool-use contracts when external actions are expected.
- Runner receipts for long tasks and cost/budget tracking.

Minimal runner plan task:

```json
{
  "schema": "proofloop-runner-plan-v1",
  "tasks": [
    {
      "id": "workstreambench.local",
      "command": "npm run benchmark:workstreambench:local",
      "estimatedCostUsd": 0
    }
  ]
}
```

Then run:

```bash
npx proofloop runner run --plan .proofloop/runner/workstreambench.plan.json --budget-usd 1
```
