-- Migration 023 — provider-documents bucket RLS policies.
--
-- The provider-documents bucket currently has 0 RLS policies.
-- Any authenticated user can read any object via the Supabase Storage API
-- directly (bypassing the API route which uses service_role).
--
-- The upload route uses service_role (admin client) — it is unaffected by
-- these policies. These policies guard direct browser/API access only.
--
-- Path format: {provider_uuid}/{document_type}.{ext}
-- e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890/emirates_id.jpg

-- Allow providers to read their own documents (path starts with their user id).
CREATE POLICY "Providers read own documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'provider-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow providers to insert their own documents.
-- The API route uses service_role so this is a fallback guard only.
CREATE POLICY "Providers insert own documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'provider-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow providers to update (upsert) their own documents.
CREATE POLICY "Providers update own documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'provider-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'provider-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- No DELETE policy — providers cannot delete their own documents.
-- Deletion requires service_role (admin action only).

-- No anon policy — bucket is fully private to authenticated users only.
-- service_role bypasses RLS entirely (Supabase default behaviour).
