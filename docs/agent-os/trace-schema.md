# trace-schema.md

Recommended trace events:

- `target_scan_started`
- `target_scan_completed`
- `benchmark_family_matched`
- `adapter_configured`
- `adapter_missing`
- `runner_plan_written`
- `context_report_written`
- `gate_started`
- `gate_completed`
- `task_started`
- `task_completed`
- `budget_blocked`
- `receipt_verified`
- `permission_required`
- `claim_rejected`

Each event should include timestamp, target id, command or receipt path, status, and blocker text when relevant.

