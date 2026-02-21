INSERT INTO storage.buckets (id, name, public)
VALUES ('session-exports', 'session-exports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_session_exports_select_auth"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'session-exports');

CREATE POLICY "storage_session_exports_insert_auth"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'session-exports');

