-- Add session mode (general | banking | interview)
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS session_mode text NOT NULL DEFAULT 'general';

ALTER TABLE public.sessions
ADD CONSTRAINT sessions_session_mode_check
CHECK (session_mode IN ('general', 'banking', 'interview'));

-- Segment risks (banking extraction)
CREATE TABLE IF NOT EXISTS public.segment_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES public.transcript_segments(id) ON DELETE CASCADE,
  risk_type text NOT NULL,
  value_raw text NOT NULL,
  value_redacted text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS segment_risks_segment_id_idx ON public.segment_risks(segment_id);
CREATE INDEX IF NOT EXISTS segment_risks_type_idx ON public.segment_risks(risk_type);

ALTER TABLE public.segment_risks ENABLE ROW LEVEL SECURITY;

CREATE POLICY segment_risks_select_own
ON public.segment_risks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = segment_risks.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segment_risks_insert_own
ON public.segment_risks
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = segment_risks.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segment_risks_update_own
ON public.segment_risks
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = segment_risks.segment_id
      AND s.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = segment_risks.segment_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY segment_risks_delete_own
ON public.segment_risks
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transcript_segments ts
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE ts.id = segment_risks.segment_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.segment_risks TO authenticated;

-- Session summaries
CREATE TABLE IF NOT EXISTS public.session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  mode text NOT NULL,
  language_primary text NOT NULL,
  language_secondary text NOT NULL,
  summary_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_summaries_session_id_idx ON public.session_summaries(session_id);

ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_summaries_select_own
ON public.session_summaries
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_summaries.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY session_summaries_insert_own
ON public.session_summaries
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_summaries.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY session_summaries_update_own
ON public.session_summaries
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_summaries.session_id
      AND s.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_summaries.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY session_summaries_delete_own
ON public.session_summaries
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = session_summaries.session_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_summaries TO authenticated;

