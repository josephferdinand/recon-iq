# DEV coupled opaque API / AI preservation verification

This packet is ready for parent review and **exact coupled migration rollback**. No migration or apply was executed by this lane. Only this folder and its output were written; parent release scripts, shared source, original prepared SQL and private inputs remain unchanged. Target is strictly `YOUR_PROJECT_REF`; no PROD requests, Docker, builds, browser profiles, billing changes, session termination, or credential/role changes.

## Verified result

The old full-column JSON aggregation exceeds a server-enforced 20-second timeout on `recon_exceptions` alone (SQLSTATE 57014). It was reproduced once with `EXPLAIN ANALYZE`, without returning application rows. Earlier two 110-second timeouts had already ended: fresh activity was empty and DEV was 431/latest `20261004080000`.

The replacement passed snapshot and preservation across all 34 originally selected public tables, 81,486 rows, the exact original ledger hash, and all three original accounting function owner/ACL/ABI/configuration contracts. The temporary-only transaction took 10,612 ms including HTTP overhead. Its largest-table sorted digest plan took 2,715.849 ms, sorted 32-byte values and used 769 KB sort memory. Nine focused behavior checks passed: reorder, value edit, null edit, deletion, insertion, same-count duplicate redistribution, JSON edit, added column outside original projection, empty table.

The evidence distinguishes temporary verification from migration verification. The initial strictly read-only transaction rejected temporary table creation with SQLSTATE 25006 before verification ran. The successful probe used `read_only:false` solely for temporary tables and their contents, read existing application/catalog rows under a repeatable-read snapshot, then rolled back. It omitted business-table locks only in this probe; **the review packet retains the original SHARE locks**. It executed no coupled source bodies, durable application writes or ledger insertion. It does not prove migration application, runtime API acceptance, or owner acceptance.

## Replacement and preservation contract

Each original projected row is serialized by the same `to_jsonb(x)::text` expression and UTF-8 encoding, hashed individually with SHA-256, and sorted as fixed 32-byte `bytea`. A cursor folds the sorted stream into a constant 32-byte SHA-256 state, seeded with `FVI-OA-ROWSET-V2`. Count and final fingerprint must both match. All projected column names/values/nulls and duplicate multiplicities participate, regardless of physical row order. Empty tables have a deterministic seed fingerprint. New columns intentionally remain outside the frozen old-column projection, as in v1.

This avoids the full-table JSON array and large JSON text sort keys. The verification blocks temporarily use `work_mem=4MB` and restore the prior setting before leaving each block. PostgreSQL sorts may spill when their memory limit is exceeded; the fingerprint state and cursor payload stay small. This is a sort-memory bound, not a claim that every backend allocation is capped at 4 MB; serialization still needs memory for an individual row. The original and replacement both rely on SHA-256 collision resistance.

Both verification blocks must be replaced together: v1 whole-array hashes and v2 running hashes are deliberately not interchangeable. No source guard, ledger guard/hash, existing function contract guard, column projection, table selection, row-count check, business lock, timeout, source default, owner, ACL or ABI is removed or normalized. A mechanical reverse replacement proves **every other byte of the prepared dry-run remains identical**.

Frozen source SHA-256: `2c8fc13fe376bc48fdcf9084b21feaaec2b08fa8b9c62a5644c9f4430dd6f991`.

Original DEV dry-run SHA-256: `981b05c528ec65ad8b7d131ade3b407a443780de95982e4d9d2d3dc3bbc13555`.

Candidate DEV dry-run SHA-256: `da75a53b08c3bc0ec65e8fb71f1be1f3eba1dcac585311c13553dbb651878045`.

## Parent integration

1. Review `rewrite.mjs`, `output/snapshot-replacement.sql`, `output/preserve-replacement.sql`, `output/rewrite-proof.json` and `output/READY.json`. The source files and hashes are loaded from the existing private v1 PREPARED manifest; nothing in that directory is overwritten.
2. Review `output/DEV-REVIEW-ONLY-DRY-RUN.sql`. Generate the matching apply packet under parent ownership using both replacements. The exported `rewritePacket` performs exact preimage checks and verifies that reverse replacement recovers the input bytes. No apply file is generated or executable apply mode is provided here.
3. Run the **exact candidate coupled SQL rollback**, with original 90-second statement timeout, 5-second lock timeout, strict catalog guard and DEV 431/latest80000 precondition intact. Preserve its independently verified rollback receipt. This lane's temporary-only proof is not a substitute.
4. Verify current DEV identity/absence of migration effects after execution. If outcome is uncertain, read back; do not blindly replay or terminate other sessions. Parent alone owns subsequent apply/build/deploy.

Reproducible commands from canonical workspace:

```powershell
node scripts/qa/dev-opaque-verification-20261004/rewrite.mjs
node scripts/qa/dev-opaque-verification-20261004/diagnose.mjs metadata
node scripts/qa/dev-opaque-verification-20261004/probe.mjs full
node scripts/qa/dev-opaque-verification-20261004/probe.mjs behavior
node scripts/qa/dev-opaque-verification-20261004/finalize.mjs
```

Do not rerun `old-plan` or all cost probes merely to integrate this fix; existing evidence is retained. Output named `readonly-full-probe.sql` is the historical filename of the successful temporary-only probe; `probe-summary.json` and `temporary-full-probe.json` explicitly record its actual transaction mode. `readonly-full-probe-error.json` records the prior rejected read-only attempt.

## File list and evidence

- `rewrite.mjs`: exact, two-block transformation and frozen-input validation; no database execution.
- `diagnose.mjs`: fixed DEV management endpoint, secret-safe credential loading, read-only metadata/cost requests, explicitly fenced temporary-only probe requests.
- `probe.mjs`: actual full-scope and focused behavior probes; bounded old/new plan evidence.
- `finalize.mjs`: final read-only target/port/activity checks and consolidated qualification.
- `recover.mjs`: post-crash frozen-input/candidate checks and fresh read-only identity/activity receipts; preserves earlier receipts and does not rerun probes.
- `output/DEV-REVIEW-ONLY-DRY-RUN.sql`: review candidate only.
- `output/snapshot-replacement.sql`, `output/preserve-replacement.sql`: exact proposed wrappers.
- `output/READY.json`, `output/rewrite-proof.json`, `output/probe-summary.json`, `output/behavior-probe.json`: qualification receipts.
- `output/per-table-cost-summary.json`, `output/new-largest-plan.json`, `output/old-largest-plan-error.json`: measured cost/plan evidence.
- `output/final-identity.json`, `output/final-ports.json`, `output/final-activity.json`: final mutable readbacks.
- Additional raw, row-free metadata/cost/probe SQL receipts in `output/` are retained for inspection.

PostgreSQL references: [resource and sort memory](https://www.postgresql.org/docs/17/runtime-config-resource.html), [row JSON conversion](https://www.postgresql.org/docs/17/functions-json.html), [binary SHA-256](https://www.postgresql.org/docs/17/functions-binarystring.html).
