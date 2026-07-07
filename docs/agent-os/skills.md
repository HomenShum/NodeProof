# skills.md

ProofLoop skills are verifier skills. They are not personality traits.

| Skill | Input | Output | Failure mode |
|---|---|---|---|
| Target scan | Repo and optional URL | Target plan JSON and context report | Overclaiming benchmark readiness |
| Gate run | `proofloop.config.json` or npm test fallback | Gate receipt | Empty checks treated as pass |
| Browser smoke | URL and Playwright repo | Smoke spec and runner task | Treating smoke as full user workflow |
| Runner supervision | Runner plan | Append-only ledger and state | Non-terminating watch tasks |
| Tool-use verification | Contract and log | Pass/fail contract receipt | Empty log certified as safe |
| Context report | Target plan, manifest, gate state | Markdown handoff page | LLM prose inventing state |

Every skill must expose inputs, outputs, receipts, and blocker language.

