ALTER TABLE public.segment_risks
ADD COLUMN IF NOT EXISTS confirmed_by uuid;

ALTER TABLE public.segment_risks
ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.segment_risks
ADD COLUMN IF NOT EXISTS override_reason text;

ALTER TABLE public.segment_risks
ADD COLUMN IF NOT EXISTS overridden_by uuid;

ALTER TABLE public.segment_risks
ADD COLUMN IF NOT EXISTS overridden_at timestamptz;

CREATE TABLE IF NOT EXISTS public.segment_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id uuid NOT NULL REFERENCES public.segment_risks(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS segment_risk_events_risk_id_idx ON public.segment_risk_events(risk_id);

ALTER TABLE public.segment_risk_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY segment_risk_events_select_own
ON public.segment_risk_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.segment_risks r
    JOIN public.transcript_segments ts ON ts.id = r.segment_id
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE r.id = segment_risk_events.risk_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT ON public.segment_risk_events TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_segment_risk_confirmed(
  risk_id uuid,
  confirm boolean,
  override_reason text DEFAULT NULL
) RETURNS public.segment_risks
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r public.segment_risks;
  owner_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.segment_risks sr
    JOIN public.transcript_segments ts ON ts.id = sr.segment_id
    JOIN public.sessions s ON s.id = ts.session_id
    WHERE sr.id = risk_id
      AND s.owner_id = auth.uid()
  ) INTO owner_ok;

  IF NOT owner_ok THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT * INTO r FROM public.segment_risks WHERE id = risk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF confirm THEN
    UPDATE public.segment_risks
    SET confirmed = true,
        confirmed_by = auth.uid(),
        confirmed_at = now(),
        override_reason = NULL,
        overridden_by = NULL,
        overridden_at = NULL
    WHERE id = risk_id
    RETURNING * INTO r;

    INSERT INTO public.segment_risk_events(risk_id, action, actor_id, reason)
    VALUES (risk_id, 'confirm', auth.uid(), NULL);
  ELSE
    IF r.confirmed IS TRUE AND (override_reason IS NULL OR length(trim(override_reason)) < 3) THEN
      RAISE EXCEPTION 'override_reason_required';
    END IF;

    UPDATE public.segment_risks
    SET confirmed = false,
        override_reason = override_reason,
        overridden_by = auth.uid(),
        overridden_at = now()
    WHERE id = risk_id
    RETURNING * INTO r;

    INSERT INTO public.segment_risk_events(risk_id, action, actor_id, reason)
    VALUES (risk_id, 'unconfirm', auth.uid(), override_reason);
  END IF;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_segment_risk_confirmed(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_segment_risk_confirmed(uuid, boolean, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.banking_case_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  form_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS banking_case_forms_session_id_idx ON public.banking_case_forms(session_id);

ALTER TABLE public.banking_case_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY banking_case_forms_select_own
ON public.banking_case_forms
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = banking_case_forms.session_id
      AND s.owner_id = auth.uid()
  )
);

CREATE POLICY banking_case_forms_insert_own
ON public.banking_case_forms
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id = banking_case_forms.session_id
      AND s.owner_id = auth.uid()
  )
);

GRANT SELECT, INSERT ON public.banking_case_forms TO authenticated;

