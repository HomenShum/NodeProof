# workers.md

ProofLoop workers are supervised tasks, not autonomous personalities.

## Lifecycle

- queued
- running
- passed
- failed
- blocked_budget
- paused

Each worker needs an id, command, working directory, optional environment, timeout, and cost estimate. The runner writes state before and after each task so the run can resume after interruption.

