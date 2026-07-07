# budget.md

Budgets make long-running proof work survivable.

Budget dimensions:

- Dollars.
- Task count.
- Runtime.
- Model route.
- Browser sessions.
- External tool calls.

When a budget is exhausted, the runner should stop with `blocked_budget`, write the ledger, and preserve the next queued task.

