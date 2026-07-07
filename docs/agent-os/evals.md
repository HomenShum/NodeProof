# evals.md

ProofLoop evals test verifier behavior.

Core eval families:

- Empty gate is not a pass.
- Failing check blocks done.
- Forged gate pass is blocked by protected paths.
- Tool-use deny-list fails closed on missing logs.
- Target planner labels missing adapters.
- Browser smoke is separate from official benchmark scoring.
- Runner resumes after interruption.
- Watch/dev scripts are not emitted as proof tasks.

When an agent discovers a new failure mode, add a test or template blocker.

