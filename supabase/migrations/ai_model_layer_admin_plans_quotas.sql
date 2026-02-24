CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text,
  auth_type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  label text NOT NULL,
  key_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider_priority
ON public.ai_provider_keys(provider_id, status, priority DESC);

CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  modality text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_model_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_pk uuid NOT NULL,
  provider_id uuid NOT NULL,
  provider_model_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_mappings_model
ON public.ai_model_mappings(model_pk, status);

CREATE TABLE IF NOT EXISTS public.ai_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_pk uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL,
  model_pk uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  monthly_request_limit integer NOT NULL DEFAULT 0,
  monthly_input_unit_limit integer NOT NULL DEFAULT 0,
  monthly_output_unit_limit integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_plan_entitlements_plan_model
ON public.ai_plan_entitlements(plan_code, model_pk);

CREATE TABLE IF NOT EXISTS public.ai_user_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_pk uuid NOT NULL,
  override_enabled boolean,
  override_monthly_request_limit integer,
  override_monthly_input_unit_limit integer,
  override_monthly_output_unit_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_user_overrides_user_model
ON public.ai_user_overrides(user_id, model_pk);

CREATE TABLE IF NOT EXISTS public.ai_user_model_selection (
  user_id uuid PRIMARY KEY,
  model_pk uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_usage_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_pk uuid NOT NULL,
  month text NOT NULL,
  requests_used integer NOT NULL DEFAULT 0,
  input_units_used integer NOT NULL DEFAULT 0,
  output_units_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_usage_months_user_model_month
ON public.ai_usage_months(user_id, model_pk, month);

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_pk_requested uuid NOT NULL,
  model_pk_used uuid NOT NULL,
  provider_id_used uuid,
  provider_key_id_used uuid,
  used_fallback boolean NOT NULL DEFAULT false,
  downgraded boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  error_code text,
  input_units integer NOT NULL DEFAULT 0,
  output_units integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at
ON public.ai_usage_events(created_at DESC);

DO $$
BEGIN
  BEGIN
    CREATE TRIGGER trg_ai_providers_updated_at
    BEFORE UPDATE ON public.ai_providers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_provider_keys_updated_at
    BEFORE UPDATE ON public.ai_provider_keys
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_models_updated_at
    BEFORE UPDATE ON public.ai_models
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_routing_policies_updated_at
    BEFORE UPDATE ON public.ai_routing_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_plan_entitlements_updated_at
    BEFORE UPDATE ON public.ai_plan_entitlements
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_user_overrides_updated_at
    BEFORE UPDATE ON public.ai_user_overrides
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE TRIGGER trg_ai_user_model_selection_updated_at
    BEFORE UPDATE ON public.ai_user_model_selection
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;

DROP FUNCTION IF EXISTS public.ai_current_billing_month();

CREATE OR REPLACE FUNCTION public.ai_current_billing_month()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(date_trunc('month', now())::date, 'YYYY-MM');
$$;

DROP FUNCTION IF EXISTS public.ai_next_month_start_utc();

CREATE OR REPLACE FUNCTION public.ai_next_month_start_utc()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('month', (now() at time zone 'utc')) + interval '1 month') at time zone 'utc';
$$;

DROP FUNCTION IF EXISTS public.ai_get_allowed_models(uuid);

CREATE OR REPLACE FUNCTION public.ai_get_allowed_models(uid uuid)
RETURNS TABLE(
  model_id text,
  display_name text,
  remaining_requests integer,
  remaining_input_units integer,
  remaining_output_units integer,
  resets_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH plan AS (
    SELECT (public.get_user_plan(uid)).plan_code AS plan_code
  ), ent AS (
    SELECT
      e.model_pk,
      m.model_id,
      m.display_name,
      COALESCE(o.override_enabled, e.is_enabled) AS enabled,
      COALESCE(o.override_monthly_request_limit, e.monthly_request_limit) AS req_limit,
      COALESCE(o.override_monthly_input_unit_limit, e.monthly_input_unit_limit) AS in_limit,
      COALESCE(o.override_monthly_output_unit_limit, e.monthly_output_unit_limit) AS out_limit
    FROM public.ai_plan_entitlements e
    JOIN plan p ON p.plan_code = e.plan_code
    JOIN public.ai_models m ON m.id = e.model_pk
    LEFT JOIN public.ai_user_overrides o ON o.user_id = uid AND o.model_pk = e.model_pk
    WHERE m.status = 'active'
  ), usage AS (
    SELECT u.model_pk, u.requests_used, u.input_units_used, u.output_units_used
    FROM public.ai_usage_months u
    WHERE u.user_id = uid
      AND u.month = public.ai_current_billing_month()
  )
  SELECT
    ent.model_id,
    ent.display_name,
    CASE WHEN ent.req_limit = 0 THEN NULL ELSE GREATEST(0, ent.req_limit - COALESCE(usage.requests_used, 0)) END,
    CASE WHEN ent.in_limit = 0 THEN NULL ELSE GREATEST(0, ent.in_limit - COALESCE(usage.input_units_used, 0)) END,
    CASE WHEN ent.out_limit = 0 THEN NULL ELSE GREATEST(0, ent.out_limit - COALESCE(usage.output_units_used, 0)) END,
    public.ai_next_month_start_utc()
  FROM ent
  LEFT JOIN usage ON usage.model_pk = ent.model_pk
  WHERE ent.enabled = true
  ORDER BY ent.display_name;
$$;

DROP FUNCTION IF EXISTS public.ai_meter_model_request(uuid, uuid, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.ai_meter_model_request(
  uid uuid,
  model_pk uuid,
  input_units integer,
  output_units integer,
  request_inc integer DEFAULT 1
)
RETURNS TABLE(
  month text,
  plan_code text,
  request_limit integer,
  input_unit_limit integer,
  output_unit_limit integer,
  requests_used integer,
  input_units_used integer,
  output_units_used integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.ai_current_billing_month();
  v_plan text;
  v_enabled boolean;
  v_req_limit integer;
  v_in_limit integer;
  v_out_limit integer;
BEGIN
  SELECT (public.get_user_plan(uid)).plan_code INTO v_plan;

  SELECT
    COALESCE(o.override_enabled, e.is_enabled),
    COALESCE(o.override_monthly_request_limit, e.monthly_request_limit),
    COALESCE(o.override_monthly_input_unit_limit, e.monthly_input_unit_limit),
    COALESCE(o.override_monthly_output_unit_limit, e.monthly_output_unit_limit)
  INTO v_enabled, v_req_limit, v_in_limit, v_out_limit
  FROM public.ai_plan_entitlements e
  LEFT JOIN public.ai_user_overrides o ON o.user_id = uid AND o.model_pk = e.model_pk
  WHERE e.plan_code = v_plan
    AND e.model_pk = model_pk
  LIMIT 1;

  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'model_not_allowed';
  END IF;

  INSERT INTO public.ai_usage_months (user_id, model_pk, month, requests_used, input_units_used, output_units_used, updated_at)
  VALUES (
    uid,
    model_pk,
    v_month,
    GREATEST(request_inc, 0),
    GREATEST(input_units, 0),
    GREATEST(output_units, 0),
    now()
  )
  ON CONFLICT (user_id, model_pk, month)
  DO UPDATE
    SET requests_used = public.ai_usage_months.requests_used + EXCLUDED.requests_used,
        input_units_used = public.ai_usage_months.input_units_used + EXCLUDED.input_units_used,
        output_units_used = public.ai_usage_months.output_units_used + EXCLUDED.output_units_used,
        updated_at = now()
    WHERE (v_req_limit = 0 OR public.ai_usage_months.requests_used + EXCLUDED.requests_used <= v_req_limit)
      AND (v_in_limit = 0 OR public.ai_usage_months.input_units_used + EXCLUDED.input_units_used <= v_in_limit)
      AND (v_out_limit = 0 OR public.ai_usage_months.output_units_used + EXCLUDED.output_units_used <= v_out_limit)
  RETURNING public.ai_usage_months.requests_used, public.ai_usage_months.input_units_used, public.ai_usage_months.output_units_used
  INTO requests_used, input_units_used, output_units_used;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quota_exceeded';
  END IF;

  month := v_month;
  plan_code := v_plan;
  request_limit := v_req_limit;
  input_unit_limit := v_in_limit;
  output_unit_limit := v_out_limit;
  RETURN NEXT;
END;
$$;

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_routing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_user_model_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_providers_select_admin ON public.ai_providers;
CREATE POLICY ai_providers_select_admin
ON public.ai_providers
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_providers_write_admin ON public.ai_providers;
CREATE POLICY ai_providers_write_admin
ON public.ai_providers
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_provider_keys_select_admin ON public.ai_provider_keys;
CREATE POLICY ai_provider_keys_select_admin
ON public.ai_provider_keys
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_provider_keys_write_admin ON public.ai_provider_keys;
CREATE POLICY ai_provider_keys_write_admin
ON public.ai_provider_keys
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_models_select_admin ON public.ai_models;
CREATE POLICY ai_models_select_admin
ON public.ai_models
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_models_write_admin ON public.ai_models;
CREATE POLICY ai_models_write_admin
ON public.ai_models
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_model_mappings_select_admin ON public.ai_model_mappings;
CREATE POLICY ai_model_mappings_select_admin
ON public.ai_model_mappings
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_model_mappings_write_admin ON public.ai_model_mappings;
CREATE POLICY ai_model_mappings_write_admin
ON public.ai_model_mappings
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_routing_policies_select_admin ON public.ai_routing_policies;
CREATE POLICY ai_routing_policies_select_admin
ON public.ai_routing_policies
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_routing_policies_write_admin ON public.ai_routing_policies;
CREATE POLICY ai_routing_policies_write_admin
ON public.ai_routing_policies
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_plan_entitlements_select_admin ON public.ai_plan_entitlements;
CREATE POLICY ai_plan_entitlements_select_admin
ON public.ai_plan_entitlements
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_plan_entitlements_write_admin ON public.ai_plan_entitlements;
CREATE POLICY ai_plan_entitlements_write_admin
ON public.ai_plan_entitlements
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_user_overrides_select_admin ON public.ai_user_overrides;
CREATE POLICY ai_user_overrides_select_admin
ON public.ai_user_overrides
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_user_overrides_write_admin ON public.ai_user_overrides;
CREATE POLICY ai_user_overrides_write_admin
ON public.ai_user_overrides
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_user_model_selection_select_self ON public.ai_user_model_selection;
CREATE POLICY ai_user_model_selection_select_self
ON public.ai_user_model_selection
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_user_model_selection_write_self ON public.ai_user_model_selection;
CREATE POLICY ai_user_model_selection_write_self
ON public.ai_user_model_selection
FOR ALL
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_usage_months_select_self ON public.ai_usage_months;
CREATE POLICY ai_usage_months_select_self
ON public.ai_usage_months
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_usage_months_write_none ON public.ai_usage_months;
CREATE POLICY ai_usage_months_write_none
ON public.ai_usage_months
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS ai_usage_events_select_self ON public.ai_usage_events;
CREATE POLICY ai_usage_events_select_self
ON public.ai_usage_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ai_usage_events_write_none ON public.ai_usage_events;
CREATE POLICY ai_usage_events_write_none
ON public.ai_usage_events
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

GRANT SELECT ON public.ai_providers TO authenticated;
GRANT SELECT ON public.ai_provider_keys TO authenticated;
GRANT SELECT ON public.ai_models TO authenticated;
GRANT SELECT ON public.ai_model_mappings TO authenticated;
GRANT SELECT ON public.ai_routing_policies TO authenticated;
GRANT SELECT ON public.ai_plan_entitlements TO authenticated;
GRANT SELECT ON public.ai_user_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_user_model_selection TO authenticated;
GRANT SELECT ON public.ai_usage_months TO authenticated;
GRANT SELECT ON public.ai_usage_events TO authenticated;

GRANT EXECUTE ON FUNCTION public.ai_get_allowed_models(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_meter_model_request(uuid, uuid, integer, integer, integer) TO authenticated;

INSERT INTO public.ai_providers (key, name, base_url, auth_type, status)
VALUES
  ('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com', 'google', 'active'),
  ('openai', 'OpenAI', 'https://api.openai.com/v1', 'bearer', 'active')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    base_url = EXCLUDED.base_url,
    auth_type = EXCLUDED.auth_type,
    status = EXCLUDED.status;

INSERT INTO public.ai_models (model_id, display_name, modality, status)
VALUES
  ('translate_lite', 'Translate Lite', 'text', 'active'),
  ('translate_pro', 'Translate Pro', 'text', 'active')
ON CONFLICT (model_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    modality = EXCLUDED.modality,
    status = EXCLUDED.status;

INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
SELECT m.id, p.id, 'gemini-2.0-flash', 'active'
FROM public.ai_models m
JOIN public.ai_providers p ON p.key = 'gemini'
WHERE m.model_id = 'translate_lite'
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
SELECT m.id, p.id, 'gemini-2.5-pro', 'active'
FROM public.ai_models m
JOIN public.ai_providers p ON p.key = 'gemini'
WHERE m.model_id = 'translate_pro'
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_routing_policies (model_pk, status, policy)
SELECT m.id, 'active', jsonb_build_object(
  'primary', jsonb_build_object('provider_key', 'gemini', 'key_strategy', 'priority'),
  'fallbacks', jsonb_build_array(jsonb_build_object('provider_key', 'openai')),
  'max_attempts', 2,
  'retry_on', jsonb_build_array('timeout','5xx','rate_limit'),
  'quota_exhausted_fallback_model_id', 'translate_lite'
)
FROM public.ai_models m
WHERE m.model_id IN ('translate_lite','translate_pro')
ON CONFLICT (model_pk) DO UPDATE
SET status = EXCLUDED.status,
    policy = EXCLUDED.policy;

INSERT INTO public.ai_plan_entitlements (plan_code, model_pk, is_enabled, monthly_request_limit, monthly_input_unit_limit, monthly_output_unit_limit)
SELECT 'free', m.id, true,
  CASE WHEN m.model_id = 'translate_pro' THEN 10 ELSE 0 END,
  0,
  0
FROM public.ai_models m
WHERE m.model_id IN ('translate_lite','translate_pro')
ON CONFLICT (plan_code, model_pk) DO UPDATE
SET is_enabled = EXCLUDED.is_enabled,
    monthly_request_limit = EXCLUDED.monthly_request_limit,
    monthly_input_unit_limit = EXCLUDED.monthly_input_unit_limit,
    monthly_output_unit_limit = EXCLUDED.monthly_output_unit_limit;

INSERT INTO public.ai_plan_entitlements (plan_code, model_pk, is_enabled, monthly_request_limit, monthly_input_unit_limit, monthly_output_unit_limit)
SELECT 'pro', m.id, true, 0, 0, 0
FROM public.ai_models m
WHERE m.model_id IN ('translate_lite','translate_pro')
ON CONFLICT (plan_code, model_pk) DO UPDATE
SET is_enabled = EXCLUDED.is_enabled,
    monthly_request_limit = EXCLUDED.monthly_request_limit,
    monthly_input_unit_limit = EXCLUDED.monthly_input_unit_limit,
    monthly_output_unit_limit = EXCLUDED.monthly_output_unit_limit;
