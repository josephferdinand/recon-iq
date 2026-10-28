# EULER — Access full production acceptance return

**Status: coupled access fix packet ready; live Access closure remains open until parent rollback, apply, deployment and the bounded recheck.** This lane writes only this helper folder and `output/access-full-acceptance-20261004`. It has not edited shared source or the frozen candidate, applied SQL, built/deployed, touched the parent's stage, changed existing roles/credentials/MFA, created browser profiles, or used Docker. The DEV verifier stays frozen. Retained Reference 69 PROD + 29 DEV and parent reconciliation 73-step proof are not rerun or claimed as this lane's work.

## Actual production evidence

All business requests went through `https://app.reconiq.example/_serverFn/…` or the existing PROD public Supabase transport with actual normal QA JWTs. Password sign-in plus each QA actor's own real TOTP challenge/verification produced AAL2. Sessions and secrets stayed in process; no bearer, password, seed or refresh token was written to output.

The positive creator/approver is **Volta: tenant_admin=true, platform_admin=false**. The scoped observer and ungranted analyst are both active tenant analysts with both admin checks false. Kepler's compound tenant/platform admin was used only as an authorized independent review checker, never as a negative control.

Only newly owned BU/group/workspace/custom role, memberships, resource roots, registrations, grants, requests, campaigns and synthetic runs were mutated. `OWNED.json` and `JOURNAL.jsonl` retain exact IDs/intents/results. Old tenant role projections remained equal through the cycle; no old role or grant row was changed.

The independently approved new group enabled actual RLS reads, scoped definition export, persisted reconciliation edit, a real two-row one-sided reconciliation run (`297bd47f-63d5-4ddc-915b-e2a94409b6e6`), persisted DataPrep edit and a real correlated DataPrep run (`8fc98aec-356d-480b-9aa1-5e4c9a4ebe81`, success, 2 in/2 out). The new definition remains a legitimate development draft on the production host; this does not prove the production-locked reconciliation cutover. No matching outcome was forced through old records.

Request `c6ce1d5e-fc2d-4643-80ca-8f575aefe6ac` was independently approved, version 1→2. The ordinary requester was refused approval. A current-snapshot access review revoked the exact new group membership; stale version refusal returned bounded HTTP409/PT409. Current reads, recon view/run/edit decisions and scoped export changed from allowed to denied using the same JWT within the recorded review continuation. Collector recoveries required fresh normal MFA sessions; their segments are expressly separated rather than falsely claiming one uninterrupted token across crashes.

Request/approval/revocation audit IDs **30730, 30731, 30764** were ordinarily read back. One collector assertion initially omitted the revocation audit because that RPC returns its ID in `history`; the corrected exact-ID read proved all three. The original failed assertion is retained with its correction. Actual expired retained JWT was refused. The group nonmember remained denied; ordinary workspace membership self-promotion and Access Explorer inspection of another QA user were refused.

`WORKFLOW.json`: 55 checks / 54 passed, with the one collector audit extraction corrected in the later receipt. `POST-REVOCATION-*`: 10 checks / 8 passed, exposing the two real access defects below. These counts are reported by source rather than summed into an inflated pass claim.

## Reproduced defects and complete proposed fixes

1. **Revoked DataPrep save persisted.** The revoked ordinary analyst still renamed only this lane's registered pipeline through the public upsert wrapper/`SECURITY DEFINER` API routine. A separate ordinary admin read confirmed the saved name, while the new group membership was absent. Add a current typed-resource `edit` decision to `public.upsert_data_prep_pipeline_for_api` after the existing locked target read and before its existing lifecycle checks/update. The original actor assertion, create branch, lifecycle/reapproval logic, audit, arguments/results and configuration stay byte-preserved. Unregistered legacy handling is preserved rather than silently cut over.
2. **Other-user permission disclosure.** The same nonadmin retrieved 77 permissions for the other authorized QA administrator through both the group inspector and the public `effective_user_permissions` RPC. Add an explicit self/admin subject guard to the app handler and caller predicates to all three SQL UNION branches. Original query bodies, duplicate semantics, defaults, result schema, ACL, owner and search path are retained. Existing self, active tenant-admin, platform-admin read, service-role ACL and direct SQL-owner contexts are preserved; ordinary JWT callers cannot claim the owner exception merely because the function is `SECURITY DEFINER`. The child's business transport never used service-role or management credentials.
3. **No-BU new group accepted.** Pure tenant admin created one new no-BU group. That exact new fixture was immediately associated with this lane's newly owned BU and its creation audit retained; no historical orphan group was assigned an invented relationship. Require an active current-tenant BU in custom group creation and explicit reassociation; require tenant-admin for BU/group writes, with no platform-only fallback. The existing form identifies the required BU, filters archived options, shows load/error/empty states and blocks invalid save. Legacy name-only group edits remain available; no old group is backfilled.

## Packet files

- `output/access-full-acceptance-20261004/READY-RETURN.json`: consolidated handover, current metadata, actual proof, hashes and residual acceptance gates.
- `packet/candidate-access-only.patch`: exact frozen release-candidate patch.
- `packet/canonical-access-only.patch`: canonical sibling patch. Apply only the patch matching the parent's actual checkout; never apply both to one tree.
- `packet/MANIFEST.json`: exact six preimage/postimage hashes for three source files in the two existing trees: `src/lib/groups.functions.ts`, `src/lib/business-units.functions.ts`, `src/components/groups-tab.tsx`.
- `packet/PROPOSED_ACCESS_FORWARD.sql`: exact two function definitions plus source/authority/ABI/configuration guards; no transaction, ledger insertion or apply mode.
- `packet/SQL-MANIFEST.json`: current catalogue preimages and proposed body hashes/authority contracts. Private typed-resource helper and public wrappers are retained.
- `packet/*.preimage`, `packet/*.proposed`, `packet/*.preimage.sql`, `packet/*.proposed.sql`: complete reviewed source inputs/outputs.
- `packet/FOCUSED-PROOF.json`: **54** isolated mocked-handler cases and TSX parsing/preserved-inspector proof. This is local proof, not hosted deployment.
- `GUARD-PROOF-*`: **2 actual hosted** typed-authority predicates (pure-admin true/revoked ordinary false) plus **8 local** SQL-context truth-table cases. This does not execute the new SQL definitions.
- `CONFIRMED-GAPS-*`, `ORPHAN-PROBE.json`, `POST-REVOCATION-*`, `WORKFLOW.json`, `JOURNAL.jsonl`, `OWNED.json`: retained live reproductions and owned fixture/audit trail.
- `CURRENT-READY-METADATA-*`: current PG17.6 / ledger455 / latest `20261004082000`, and both unchanged live function preimages. The metadata read/save completed; Node's earlier abrupt `process.exit` caused a Windows handle shutdown assertion afterward. The helper now exits normally; no DB failure or business retry occurred.
- `PACKET-FILE-LIST.json`: byte/hash inventory of every packet artifact.

Candidate source patch SHA256: `561728b60d9b388aed329b1d0e3fde9397e62d6381c96cd40c1dce9890a08086`.

SQL forward SHA256: `49ff86edc36f33ba0eedc166accc9baed13cad141a49bff9e4af65f3e9ed4c23`.

## Parent integration and bounded live recheck

Parent must check exact source/catalogue preimages, integrate the three source files with the two SQL functions, retain its complete existing-row/ledger protection and required checks, execute the actual exact PG17 rollback (including preserved privileged contexts), then apply/deploy. This lane has no SQL apply, global compiler/build or deployment authority. Do not waive a mismatch or replay any completed setup/request/run/revocation.

After the verified release, save the parent receipt containing `target: "PROD YOUR_PROJECT_REF"`, `sqlCommitVerified: true`, `sourceDeployed: true`, the actual `deploymentId`, `exactRollbackReceipt`, `sourcePatchSha256` and `sqlForwardSha256`. Then run:

```powershell
node scripts/qa/access-full-acceptance-20261004/recheck.mjs C:/exact/parent-release-receipt.json
```

`recheck.mjs` refuses a missing or mismatched receipt before any request. It uses fresh real QA MFA and the exact retained revoked new pipeline, checks the actual public save refusal/no row change, raw permission RPC isolation, group inspector denial, missing-BU creation refusal and preserved pure-admin mapped authority. It does not rerun positive creation, approval, reconciliation/DataPrep runs or revocation. It does not apply SQL or change old roles.

The known fixes are ready. Other DataPrep lifecycle RPCs, production-locked nonadmin reconciliation cutover, true tenant nonmembership (separate from proved group nonmembership), preset-group association and final browser/owner acceptance remain explicitly unclaimed. No screenshots were captured and no live-fixed claim is made before parent integration.
