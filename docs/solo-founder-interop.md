# Solo Founder Agent Builder Interoperability

NodeProof and Solo Founder Agent Builder have separate jobs:

- Solo Founder owns RALPH planning, research, repair routing, agent-host context, and the .solo/ work journal.
- NodeProof owns receipt validation, budget and provenance checks, runner handoff, protected promotion state, and the authoritative .proofloop/ gate.

Solo verdicts are advisory. NodeProof derives the claim that may be promoted.

## Install

For a pinned local checkout:

~~~bash
git clone https://github.com/HomenShum/solo-founder-agent-builder
npx proofloop init --agent auto --live
npx proofloop solo setup --source ../solo-founder-agent-builder --agent both --install-deps --verify
npx proofloop ci install github
~~~

The canonical project skill is installed at .agents/skills/solo-founder-nodes, which is the Codex project-skill location. Claude Code receives a small wrapper at .claude/skills/solo-founder-nodes that points to the same canonical skill instead of duplicating it. See the current [Codex customization guidance](https://developers.openai.com/codex/concepts/customization) and [Claude Code skills guidance](https://code.claude.com/docs/en/slash-commands).

The setup command refuses a conflicting skill unless --force is explicit. It records source and manifest digests in .proofloop/setup/solo-founder.json.
It also installs one composed Stop gate for each selected host. Use --local for uncommitted host settings or --no-hooks when host policy is managed elsewhere.

## Run

~~~bash
npm run sfn -- loop init --goal "prove the customer workflow" --project .
npm run sfn -- loop status --project .
npm run sfn -- proofloop export \
  --project . \
  --out .solo/proofloop-interop.json \
  --program-id customer-workflow \
  --goal-id customer-workflow-v1 \
  --actor local-founder \
  --role owner \
  --agent-host codex \
  --tier local_ready \
  --boundary product_path
npx proofloop solo ingest --file .solo/proofloop-interop.json --write-runner-plan
npx proofloop solo status
npx proofloop solo gate
~~~

solo ingest verifies the contract, repository SHA, budget, safe paths, receipt bytes and hashes, scorer ordering, task graph, and tier requirements. --write-runner-plan writes an advisory plan but does not execute it.

## Claim Tiers

| Tier | Required authority |
|---|---|
| local_ready | Valid required receipts and a NodeProof-derived local gate |
| team_ready | Local evidence plus an independent nodeproof-ci receipt bound to the candidate SHA |
| certification_ready | Team proof plus a signed hosted-trust-root receipt |

Product-path, proxy, and official claims remain separate. An official claim requires official scorer metadata and proof that candidate output existed before evaluator access.

## Team Promotion Flow

The GitHub workflow needs the local-ready envelope and every file it references. The default .gitignore keeps .solo private, so inspect the envelope first and force-add only a reviewed proof package on a dedicated evidence commit:

~~~bash
git add -f .solo/proofloop-interop.json .solo/proof-verdict.json
git add -f <each reviewed path from envelope.receipts>
git commit -m "attach ProofLoop evidence"
~~~

NodeProof accepts this as an evidence-only descendant of the signed product candidate. Any source, configuration, dependency, or other product change after that candidate produces stale_candidate_commit. Do not publish receipts marked private in a public repository; use a private repository or an approved private artifact lane instead.

After proofloop-gate passes, download its proofloop-receipts-<run-id> artifact and place nodeproof-ci.json inside the project, for example .solo/promotions/nodeproof-ci.json. Re-export against the same product candidate:

~~~bash
npm run sfn -- proofloop export \
  --project . \
  --out .solo/proofloop-interop.json \
  --program-id customer-workflow \
  --goal-id customer-workflow-v1 \
  --actor local-founder \
  --role owner \
  --agent-host codex \
  --tier team_ready \
  --boundary product_path \
  --promotion-receipt .solo/promotions/nodeproof-ci.json
npx proofloop solo ingest --file .solo/proofloop-interop.json
npx proofloop solo gate
~~~

The exporter recognizes only proofloop-solo-trust-root-receipt-v1 promotion artifacts and carries their key and issuer metadata. It does not verify the signature or promote the claim; NodeProof verifies Ed25519, key ID, issuer repository, workflow boundary, prior tier, goal, and product candidate. A hosted worker repeats the same sequence with a hosted-trust-root receipt for certification_ready.

## One Stop Loop

Setup generates .proofloop/hooks/solo-stop-gate.cjs. NodeProof remains the only blocking Stop hook; the composed command runs:

1. the base NodeProof gate;
2. the Solo fresh-context judge when .solo/loop-state.json exists;
3. interop import and gate when .solo/proofloop-interop.json exists.

NodeProof's PostToolUse hook also mirrors normalized, redacted tool.post events into .solo/events.jsonl while a Solo loop is active. Hook telemetry is a work journal, not certification proof.

## Two-User Workflow

1. The owner creates the goal and acceptance contract.
2. Contributors use separate branches or worktrees and distinct actorId, sessionId, and worktreeId values.
3. The candidate envelope binds evidence to the exact candidate commit.
4. A reviewer runs or requires the installed GitHub gate from a clean checkout.
5. Only the independent receipt is eligible to promote team_ready.

Branch protection must require proofloop-gate and restrict edits to its workflow. Local hooks cap retries and are feedback, not the final team trust boundary.

## Signed Team Receipts

The installed workflow can issue an Ed25519 receipt after a passing local-ready envelope:

~~~bash
openssl genpkey -algorithm Ed25519 -out proofloop-private.pem
openssl pkey -in proofloop-private.pem -pubout -out proofloop-public.pem
gh secret set PROOFLOOP_TRUST_PRIVATE_KEY_PEM < proofloop-private.pem
gh variable set PROOFLOOP_TRUST_PUBLIC_KEY_PEM < proofloop-public.pem
gh variable set PROOFLOOP_TRUST_KEY_ID --body proofloop-ci-1
~~~

Keep the private key outside the evaluated checkout and rotate it through normal repository administration. NodeProof recomputes the envelope and gate digests, signs the candidate SHA and workflow identity, and verifies higher-tier receipts with the configured public key. A JSON file merely named nodeproof-ci or hosted-trust-root is rejected.

## Security

- .solo/proof-verdict.json and .solo/proofloop-interop.json are protected from direct agent file tools.
- Working RALPH receipts remain writable.
- Receipt paths must be repository-relative and may not traverse outside the repository.
- Required receipt digests are recomputed from bytes.
- Default setup and tests use no model provider and have a $0 model budget.
- Secrets, raw credentials, held-out material, and signing keys never belong in an interop envelope.
