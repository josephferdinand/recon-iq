-- AIDP stores source documents and rendered pages behind tenant-scoped RLS.
-- Existing object policies already target bucket_id = 'aidp'; environments
-- must also provision the private bucket itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aidp',
  'aidp',
  false,
  52428800,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;
