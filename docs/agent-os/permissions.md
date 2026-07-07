# permissions.md

ProofLoop distinguishes local proof from external side effects.

## Usually Allowed

- Read local repo files.
- Write `.proofloop/` generated reports and receipts.
- Run local deterministic commands.
- Fetch a user-provided HTTP or HTTPS URL for target scanning.

## Requires Care

- Publishing packages.
- Sending emails or form submissions.
- Changing DNS, deployment settings, or secrets.
- Running official scorers that call paid models.
- Uploading private code or artifacts to a hosted service.

ProofLoop should record permission blockers instead of pretending the action happened.

