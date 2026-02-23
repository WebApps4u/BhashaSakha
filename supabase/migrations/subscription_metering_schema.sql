CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  monthly_request_limit integer NOT NULL DEFAULT 0,
  monthly_char_limit integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_code text NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  override_monthly_request_limit integer,
  override_monthly_char_limit integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id_created_at
ON public.user_subscriptions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.usage_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL,
  requests_used integer NOT NULL DEFAULT 0,
  chars_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_months_user_month
ON public.usage_months(user_id, month);

CREATE TABLE IF NOT EXISTS public.translation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL,
  source_lang text,
  target_langs text[] NOT NULL DEFAULT '{}'::text[],
  source_chars integer NOT NULL DEFAULT 0,
  output_chars integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_translation_requests_user_month
ON public.translation_requests(user_id, month);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
ON public.admin_audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.current_billing_month()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(date_trunc('month', now())::date, 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.get_user_plan(uid uuid)
RETURNS TABLE(
  plan_code text,
  request_limit integer,
  char_limit integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sub AS (
    SELECT us.plan_code,
      us.override_monthly_request_limit AS req_override,
      us.override_monthly_char_limit AS char_override
    FROM public.user_subscriptions us
    WHERE us.user_id = uid
      AND us.effective_from <= current_date
    ORDER BY us.effective_from DESC, us.created_at DESC
    LIMIT 1
  ), base AS (
    SELECT p.code,
      p.monthly_request_limit AS req_limit,
      p.monthly_char_limit AS char_limit
    FROM public.subscription_plans p
    WHERE p.code = COALESCE((SELECT plan_code FROM sub), 'free')
    LIMIT 1
  )
  SELECT
    COALESCE((SELECT code FROM base), COALESCE((SELECT plan_code FROM sub), 'free')) AS plan_code,
    COALESCE((SELECT req_override FROM sub), (SELECT req_limit FROM base), 0)::int AS request_limit,
    COALESCE((SELECT char_override FROM sub), (SELECT char_limit FROM base), 0)::int AS char_limit;
$$;

CREATE OR REPLACE FUNCTION public.meter_translation(
  uid uuid,
  source_chars integer,
  output_chars integer,
  request_inc integer DEFAULT 1
)
RETURNS TABLE(
  month text,
  plan_code text,
  request_limit integer,
  char_limit integer,
  requests_used integer,
  chars_used integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.current_billing_month();
  v_plan text;
  v_req_limit integer;
  v_char_limit integer;
BEGIN
  SELECT p.plan_code, p.request_limit, p.char_limit
  INTO v_plan, v_req_limit, v_char_limit
  FROM public.get_user_plan(uid) p;

  INSERT INTO public.usage_months (user_id, month, requests_used, chars_used, updated_at)
  VALUES (uid, v_month, GREATEST(request_inc, 0), GREATEST(source_chars, 0) + GREATEST(output_chars, 0), now())
  ON CONFLICT (user_id, month)
  DO UPDATE
    SET requests_used = public.usage_months.requests_used + EXCLUDED.requests_used,
        chars_used = public.usage_months.chars_used + EXCLUDED.chars_used,
        updated_at = now()
    WHERE (v_req_limit = 0 OR public.usage_months.requests_used + EXCLUDED.requests_used <= v_req_limit)
      AND (v_char_limit = 0 OR public.usage_months.chars_used + EXCLUDED.chars_used <= v_char_limit)
  RETURNING public.usage_months.requests_used, public.usage_months.chars_used
  INTO requests_used, chars_used;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quota_exceeded';
  END IF;

  month := v_month;
  plan_code := v_plan;
  request_limit := v_req_limit;
  char_limit := v_char_limit;
  RETURN NEXT;
END;
$$;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_select_public ON public.subscription_plans;
CREATE POLICY subscription_plans_select_public
ON public.subscription_plans
FOR SELECT
TO anon
USING (is_active = true);

DROP POLICY IF EXISTS subscription_plans_select_auth ON public.subscription_plans;
CREATE POLICY subscription_plans_select_auth
ON public.subscription_plans
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS subscription_plans_write_admin ON public.subscription_plans;
CREATE POLICY subscription_plans_write_admin
ON public.subscription_plans
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_subscriptions_select_self ON public.user_subscriptions;
CREATE POLICY user_subscriptions_select_self
ON public.user_subscriptions
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_subscriptions_write_admin ON public.user_subscriptions;
CREATE POLICY user_subscriptions_write_admin
ON public.user_subscriptions
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS usage_months_select_self ON public.usage_months;
CREATE POLICY usage_months_select_self
ON public.usage_months
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS usage_months_write_none ON public.usage_months;
CREATE POLICY usage_months_write_none
ON public.usage_months
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS translation_requests_select_self ON public.translation_requests;
CREATE POLICY translation_requests_select_self
ON public.translation_requests
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS translation_requests_write_none ON public.translation_requests;
CREATE POLICY translation_requests_write_none
ON public.translation_requests
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS admin_audit_log_select_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_log_select_admin
ON public.admin_audit_log
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_audit_log_insert_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_log_insert_admin
ON public.admin_audit_log
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.subscription_plans (code, name, monthly_request_limit, monthly_char_limit, is_active)
VALUES
  ('free', 'Free', 50, 25000, true),
  ('pro', 'Pro', 2000, 1000000, true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    monthly_request_limit = EXCLUDED.monthly_request_limit,
    monthly_char_limit = EXCLUDED.monthly_char_limit,
    is_active = EXCLUDED.is_active;

