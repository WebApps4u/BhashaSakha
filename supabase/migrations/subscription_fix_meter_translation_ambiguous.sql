-- Fix: every call to meter_translation failed with
--   ERROR 42702: column reference "month" is ambiguous
-- because the OUT column "month" shadows usage_months.month inside ON CONFLICT (user_id, month).
-- The server ignored that error, so usage_months / translation_requests stayed empty and the
-- plan's monthly request and character limits were never enforced.
-- Same remedy as ai_meter_model_request: prefer table columns over PL/pgSQL variables.

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
#variable_conflict use_column
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
  FROM public.get_user_plan($1) p;

  INSERT INTO public.usage_months (user_id, month, requests_used, chars_used, updated_at)
  VALUES ($1, v_month, GREATEST($4, 0), GREATEST($2, 0) + GREATEST($3, 0), now())
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

REVOKE ALL ON FUNCTION public.meter_translation(uuid, integer, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.meter_translation(uuid, integer, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
