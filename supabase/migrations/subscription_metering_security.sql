REVOKE ALL ON TABLE public.subscription_plans FROM public;
REVOKE ALL ON TABLE public.user_subscriptions FROM public;
REVOKE ALL ON TABLE public.usage_months FROM public;
REVOKE ALL ON TABLE public.translation_requests FROM public;
REVOKE ALL ON TABLE public.admin_audit_log FROM public;

GRANT SELECT ON public.subscription_plans TO anon;
GRANT ALL PRIVILEGES ON public.subscription_plans TO authenticated;

GRANT ALL PRIVILEGES ON public.user_subscriptions TO authenticated;
GRANT ALL PRIVILEGES ON public.usage_months TO authenticated;
GRANT ALL PRIVILEGES ON public.translation_requests TO authenticated;
GRANT ALL PRIVILEGES ON public.admin_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_plan(uid uuid)
RETURNS TABLE(
  plan_code text,
  request_limit integer,
  char_limit integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND uid <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
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
END;
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
  IF auth.uid() IS NOT NULL AND uid <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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

REVOKE ALL ON FUNCTION public.get_user_plan(uuid) FROM public;
REVOKE ALL ON FUNCTION public.meter_translation(uuid, integer, integer, integer) FROM public;

