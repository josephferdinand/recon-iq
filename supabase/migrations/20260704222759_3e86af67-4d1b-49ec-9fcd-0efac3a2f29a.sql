
-- RLS policies for ticket-attachments bucket.
-- Files stored at path: <tenant_id>/<ticket_id>/<filename>
-- Access = tenant membership (or platform admin).

CREATE POLICY "ticket_attachments_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments' AND (
    private.is_platform_admin(auth.uid())
    OR (
      (storage.foldername(name))[1]::uuid IS NOT NULL
      AND private.is_tenant_member(auth.uid(), (storage.foldername(name))[1]::uuid)
    )
  )
);

CREATE POLICY "ticket_attachments_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments' AND (
    private.is_platform_admin(auth.uid())
    OR (
      (storage.foldername(name))[1]::uuid IS NOT NULL
      AND private.is_tenant_member(auth.uid(), (storage.foldername(name))[1]::uuid)
    )
  )
);

CREATE POLICY "ticket_attachments_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments' AND (
    private.is_platform_admin(auth.uid())
    OR (
      (storage.foldername(name))[1]::uuid IS NOT NULL
      AND private.is_tenant_member(auth.uid(), (storage.foldername(name))[1]::uuid)
    )
  )
);
