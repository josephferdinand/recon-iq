# Database package — structure, no data

`schema-catalog.json` contains current production object definitions captured using read-only PostgreSQL catalogs. `object-acl-catalog.json` adds extension membership, composite types and ACL records. No customer records, file contents, authentication accounts, passwords, private vault values, database connection strings or deployed scheduler executions were queried or exported.

`production-schema.sql` is generated from these definitions for a **new** Supabase project. It excludes extension-owned objects from recreation, defers ordinary column defaults until routines exist, recreates application policies and restores standard client-role grants. Install/enable the required extensions first. The new provider supplies its own auth/storage/system schemas.

This is a logical reconstruction, not a tested native dump/restore. A fresh database restore, extension availability, function/view dependency order, custom roles, owners, custom grants, event triggers, default privileges and external bindings still require qualification. Complete original ACL metadata is retained for that review; do not grant broad access as a workaround. The exported source inherits existing security findings.

The catalog contains **677** tables including extension-managed objects; the generated application restore contains **676** tables and **1,012** application routines. Another **151** routine definitions are extension-owned and should be installed through their extensions. These differences are intentional and recorded.

Historical SQL migrations remain in `supabase/migrations` as source history. Do not apply both the generated schema and that entire chain: they describe overlapping objects and guarded upgrades, some of which expect historical data and qualification records. No live cron jobs, original actors, internal qualification certificates, sample business records, workspace memberships or provider configuration rows are included automatically.

After schema qualification, configure a new email/password user and the platform/tenant/group membership it actually needs, select your new AI provider configuration and use synthetic data. Templates, lookup values, model catalogs and other reference rows from the source database are not copied as production data. Review what your chosen demonstration flow needs and seed those deliberately.
