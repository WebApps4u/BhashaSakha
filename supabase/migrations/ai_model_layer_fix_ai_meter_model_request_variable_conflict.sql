-- Fix PL/pgSQL variable/column name conflict for model_pk in ai_meter_model_request.

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
#variable_conflict use_column
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
    AND e.model_pk = $2
  LIMIT 1;

  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'model_not_allowed';
  END IF;

  INSERT INTO public.ai_usage_months (user_id, model_pk, month, requests_used, input_units_used, output_units_used, updated_at)
  VALUES (
    $1,
    $2,
    v_month,
    GREATEST($5, 0),
    GREATEST($3, 0),
    GREATEST($4, 0),
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

NOTIFY pgrst, 'reload schema';

