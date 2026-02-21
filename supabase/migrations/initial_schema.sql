CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  source_lang text NOT NULL DEFAULT 'auto',
  target_langs text[] NOT NULL DEFAULT '{}'::text[],
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_owner_created_at
ON public.sessions(owner_id, created_at DESC);

CREATE TRIGGER trg_sessions_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  speaker_label text NOT NULL DEFAULT 'Speaker 1',
  start_ms integer NOT NULL DEFAULT 0,
  end_ms integer NOT NULL DEFAULT 0,
  text text NOT NULL DEFAULT '',
  is_final boolean NOT NULL DEFAULT true,
  is_edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_session_seq
ON public.transcript_segments(session_id, seq);

CREATE TRIGGER trg_segments_updated_at
BEFORE UPDATE ON public.transcript_segments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  format text NOT NULL CHECK (format IN ('txt','vtt')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','completed','failed')),
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_exports_session_created_at
ON public.exports(session_id, created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY profiles_insert_own
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY sessions_select_own
ON public.sessions
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY sessions_select_public
ON public.sessions
FOR SELECT
TO anon
USING (visibility = 'public');

CREATE POLICY sessions_insert_own
ON public.sessions
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY sessions_update_own
ON public.sessions
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY sessions_delete_own
ON public.sessions
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY segments_select_own
ON public.transcript_segments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segments_select_public
ON public.transcript_segments
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.visibility = 'public'
  )
);

CREATE POLICY segments_insert_own
ON public.transcript_segments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segments_update_own
ON public.transcript_segments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segments_delete_own
ON public.transcript_segments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = transcript_segments.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY exports_select_own
ON public.exports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = exports.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY exports_insert_own
ON public.exports
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = exports.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY exports_update_own
ON public.exports
FOR UPDATE
TO authenticated
USING (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = exports.session_id
      AND s.owner_id = auth.uid()
  )
)
WITH CHECK (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = exports.session_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT ON public.sessions, public.transcript_segments TO anon;
GRANT ALL PRIVILEGES ON public.profiles, public.sessions, public.transcript_segments, public.exports TO authenticated;

