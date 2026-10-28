-- Leibniz — PDF9 actual annotation registration failure, SELECT-only parent guard.
-- NOT RUN by this lane. Use separately verified PROD448/DEV426 connections.
-- No role/JWT injection, SQL apply, row mutation, grant, duplicate deletion or reset.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_setting('server_version') AS server_version;
SELECT c.oid::regclass AS relation, c.relrowsecurity, c.relforcerowsecurity
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('aidp_pages','aidp_documents');
SELECT a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull
FROM pg_catalog.pg_attribute a
WHERE a.attrelid=to_regclass('public.aidp_pages') AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum;
SELECT i.indexrelid::regclass AS index_name,i.indisunique,i.indisvalid,i.indisready,
       pg_get_indexdef(i.indexrelid) AS index_definition,
       pg_get_expr(i.indpred,i.indrelid) AS predicate
FROM pg_catalog.pg_index i WHERE i.indrelid=to_regclass('public.aidp_pages');
SELECT conname,contype,condeferrable,condeferred,convalidated,pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('public.aidp_pages');
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('aidp_pages','aidp_documents');
-- Owned synthetic new document only: no business-value extraction or object/signed URL dump.
SELECT count(*) AS registered_page_rows, count(*) FILTER (WHERE purpose='review') AS review_rows,
       count(*) FILTER (WHERE purpose='inference') AS inference_rows
FROM public.aidp_pages
WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid
AND document_id='ce0b5936-21be-4dbd-852d-cf70b5241cdf'::uuid;
SELECT count(*) AS duplicate_owned_conflict_groups FROM (
 SELECT document_id,page_index,purpose FROM public.aidp_pages
 WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid
 AND document_id='ce0b5936-21be-4dbd-852d-cf70b5241cdf'::uuid
 GROUP BY document_id,page_index,purpose HAVING count(*)>1
) d;
ROLLBACK;
-- Actual source expects ON CONFLICT(document_id,page_index,purpose).
-- Read the deployed routine/source and actual catalogue before choosing source-vs-schema repair.
-- A matching nonpartial valid immediate unique arbiter is needed; do not infer it from an index name.
-- Preserve the existing source and partial page-0-review.png. Resume exact document after reviewed repair.
