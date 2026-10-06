-- Interview simulator: profiles, sessions, turns, feedback + metered AI models.
-- All tables are owner-readable via RLS; writes happen server-side with the service role
-- so scores and transcripts cannot be altered from the browser.

CREATE TABLE IF NOT EXISTS public.interview_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_title text,
  company_name text,
  resume_text text,
  jd_text text,
  job_url text,
  linkedin_url text,
  portfolio_url text,
  analysis_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.interview_profiles(id) ON DELETE SET NULL,
  parent_session_id uuid REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Mock interview',
  recommended_config_json jsonb,
  config_json jsonb NOT NULL,
  panel_json jsonb NOT NULL,
  round_plan_json jsonb NOT NULL,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready',
  started_at timestamptz,
  ended_at timestamptz,
  scores_json jsonb,
  readiness integer,
  report_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_sessions_status_check
    CHECK (status IN ('ready', 'live', 'evaluating', 'completed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS public.interview_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  speaker text NOT NULL,
  persona_id text,
  action text,
  round text,
  difficulty integer,
  thread_id text,
  resume_claim_ref text,
  text text NOT NULL,
  rationale text,
  practice_tip text,
  input_mode text,
  metrics_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_turns_speaker_check CHECK (speaker IN ('interviewer', 'candidate')),
  CONSTRAINT interview_turns_session_seq_key UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS public.interview_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  question_turn_id uuid REFERENCES public.interview_turns(id) ON DELETE CASCADE,
  feedback_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_feedback_session_thread_key UNIQUE (session_id, thread_id)
);

CREATE INDEX IF NOT EXISTS interview_profiles_owner_idx ON public.interview_profiles (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_sessions_owner_idx ON public.interview_sessions (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_turns_session_idx ON public.interview_turns (session_id, seq);
CREATE INDEX IF NOT EXISTS interview_feedback_session_idx ON public.interview_feedback (session_id);

ALTER TABLE public.interview_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interview_profiles_select_own ON public.interview_profiles;
CREATE POLICY interview_profiles_select_own ON public.interview_profiles
  FOR SELECT USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS interview_profiles_delete_own ON public.interview_profiles;
CREATE POLICY interview_profiles_delete_own ON public.interview_profiles
  FOR DELETE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS interview_sessions_select_own ON public.interview_sessions;
CREATE POLICY interview_sessions_select_own ON public.interview_sessions
  FOR SELECT USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS interview_sessions_delete_own ON public.interview_sessions;
CREATE POLICY interview_sessions_delete_own ON public.interview_sessions
  FOR DELETE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS interview_turns_select_own ON public.interview_turns;
CREATE POLICY interview_turns_select_own ON public.interview_turns
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS interview_feedback_select_own ON public.interview_feedback;
CREATE POLICY interview_feedback_select_own ON public.interview_feedback
  FOR SELECT USING (auth.uid() = owner_id);

-- Metered AI models.
--   interview_session : virtual model, metered once per interview start (the "interviews per month" limit)
--   interview_lite    : live interviewer turns (fast)
--   interview_pro     : profile analysis and post-interview evaluation
INSERT INTO public.ai_models (model_id, display_name, modality, status)
VALUES
  ('interview_session', 'Interview sessions', 'text', 'active'),
  ('interview_lite', 'Interview AI (live)', 'text', 'active'),
  ('interview_pro', 'Interview AI (analysis)', 'text', 'active')
ON CONFLICT (model_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    status = EXCLUDED.status;

-- Inherit the provider mappings and routing policy currently used by translate_lite,
-- without its quota-exhausted downgrade (interview models must not silently fall back).
DO $$
DECLARE
  v_source uuid;
  v_target uuid;
  v_policy jsonb;
BEGIN
  SELECT id INTO v_source FROM public.ai_models WHERE model_id = 'translate_lite' LIMIT 1;
  IF v_source IS NULL THEN
    RETURN;
  END IF;

  SELECT policy INTO v_policy FROM public.ai_routing_policies WHERE model_pk = v_source LIMIT 1;

  FOR v_target IN SELECT id FROM public.ai_models WHERE model_id IN ('interview_lite', 'interview_pro') LOOP
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    SELECT v_target, m.provider_id, m.provider_model_name, m.status
    FROM public.ai_model_mappings m
    WHERE m.model_pk = v_source
      AND NOT EXISTS (
        SELECT 1 FROM public.ai_model_mappings x
        WHERE x.model_pk = v_target AND x.provider_id = m.provider_id
      );

    IF v_policy IS NOT NULL THEN
      INSERT INTO public.ai_routing_policies (model_pk, policy)
      VALUES (v_target, v_policy - 'quota_exhausted_fallback_model_id')
      ON CONFLICT (model_pk) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Plan entitlements (0 = unlimited). Existing rows are left untouched so admin edits survive re-runs.
INSERT INTO public.ai_plan_entitlements (plan_code, model_pk, is_enabled, monthly_request_limit, monthly_input_unit_limit, monthly_output_unit_limit)
SELECT v.plan_code, m.id, true, v.req_limit, 0, 0
FROM (
  VALUES
    ('free', 'interview_session', 2),
    ('free', 'interview_lite', 100),
    ('free', 'interview_pro', 40),
    ('pro', 'interview_session', 30),
    ('pro', 'interview_lite', 0),
    ('pro', 'interview_pro', 0)
) AS v(plan_code, model_id, req_limit)
JOIN public.ai_models m ON m.model_id = v.model_id
ON CONFLICT (plan_code, model_pk) DO NOTHING;

NOTIFY pgrst, 'reload schema';
