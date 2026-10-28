INSERT INTO public.tenant_families (id, name, release_identity_uid, canonical_legal_name)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'Reconciliation Identifier Evidence Family',
  'e2000000-0000-4000-8000-000000000003',
  'Reconciliation Identifier Evidence Family'
);

INSERT INTO public.tenants (id, family_id, slug, name, environment)
VALUES (
  'e2000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  'reconciliation-identifier-evidence',
  'Reconciliation Identifier Evidence',
  'dev'
);

INSERT INTO public.business_units (id, tenant_id, name, code)
VALUES (
  'e2000000-0000-4000-8000-000000000004',
  'e2000000-0000-4000-8000-000000000002',
  'Treasury Operations',
  'TREAS'
);

INSERT INTO public.recon_definitions (
  id, tenant_id, bu_id, name, recon_type, sides, rules, created_at
)
VALUES
  ('e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000004', 'Legacy Cash Position', 'one_sided', '[]', '[]', '2026-01-01T00:00:00Z'),
  ('e2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000004', 'Legacy Nostro', 'one_sided', '[]', '[]', '2026-01-02T00:00:00Z'),
  ('e2000000-0000-4000-8000-000000000013', 'e2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000004', 'Legacy Cash versus Ledger', 'two_sided', '[]', '[]', '2026-01-03T00:00:00Z');
