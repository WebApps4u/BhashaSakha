ALTER TABLE public.transcript_segments
ADD COLUMN IF NOT EXISTS detected_lang text;

CREATE TABLE IF NOT EXISTS public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES public.transcript_segments(id) ON DELETE CASCADE,
  target_lang text NOT NULL,
  text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(segment_id, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_translations_segment
ON public.translations(segment_id);

CREATE TRIGGER trg_translations_updated_at
BEFORE UPDATE ON public.translations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY translations_select_own
ON public.translations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY translations_select_public
ON public.translations
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.visibility = 'public'
  )
);

CREATE POLICY translations_insert_own
ON public.translations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY translations_update_own
ON public.translations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY translations_delete_own
ON public.translations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = translations.segment_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT ON public.translations TO anon;
GRANT ALL PRIVILEGES ON public.translations TO authenticated;
