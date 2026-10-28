ALTER TABLE public.github_sync_change_requests
  ADD COLUMN IF NOT EXISTS post_apply_verified boolean,
  ADD COLUMN IF NOT EXISTS post_apply_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_apply_verification jsonb;

COMMENT ON COLUMN public.github_sync_change_requests.post_apply_verified IS 'Result of the automatic audit-chain verification run immediately after the change was applied. NULL = not yet verified.';
COMMENT ON COLUMN public.github_sync_change_requests.post_apply_verified_at IS 'Timestamp of the automatic post-apply verification.';
COMMENT ON COLUMN public.github_sync_change_requests.post_apply_verification IS 'Summary JSON of the post-apply verification: { evidence_ok, chain_ok, all_evidence_links_ok, first_bad_audit_id, audit_entry_count, recomputed_evidence_sha256 }.';