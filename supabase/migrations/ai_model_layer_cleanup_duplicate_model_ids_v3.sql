-- Cleanup duplicate internal model IDs caused by '-' vs '_' variants.
-- Canonical form: use '_' (underscore). Any model_id with '-' will be merged into its '_' variant if present.

DO $$
BEGIN
  -- ai_model_mappings: if underscore already has a mapping for the same provider, keep underscore and drop dashed.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  DELETE FROM public.ai_model_mappings mm
  USING pairs p
  WHERE mm.model_pk = p.dash_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_model_mappings mm2
      WHERE mm2.model_pk = p.us_id
        AND mm2.provider_id = mm.provider_id
    );

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_model_mappings mm
  SET model_pk = p.us_id
  FROM pairs p
  WHERE mm.model_pk = p.dash_id;

  -- ai_routing_policies: keep underscore policy if exists.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  DELETE FROM public.ai_routing_policies rp
  USING pairs p
  WHERE rp.model_pk = p.dash_id
    AND EXISTS (SELECT 1 FROM public.ai_routing_policies rp2 WHERE rp2.model_pk = p.us_id);

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_routing_policies rp
  SET model_pk = p.us_id
  FROM pairs p
  WHERE rp.model_pk = p.dash_id
    AND NOT EXISTS (SELECT 1 FROM public.ai_routing_policies rp2 WHERE rp2.model_pk = p.us_id);

  -- ai_plan_entitlements: keep underscore entitlement if exists.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  DELETE FROM public.ai_plan_entitlements e
  USING pairs p
  WHERE e.model_pk = p.dash_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_plan_entitlements e2
      WHERE e2.plan_code = e.plan_code
        AND e2.model_pk = p.us_id
    );

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_plan_entitlements e
  SET model_pk = p.us_id
  FROM pairs p
  WHERE e.model_pk = p.dash_id;

  -- ai_user_overrides: keep underscore override if exists.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  DELETE FROM public.ai_user_overrides o
  USING pairs p
  WHERE o.model_pk = p.dash_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_user_overrides o2
      WHERE o2.user_id = o.user_id
        AND o2.model_pk = p.us_id
    );

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_user_overrides o
  SET model_pk = p.us_id
  FROM pairs p
  WHERE o.model_pk = p.dash_id;

  -- ai_user_model_selection: move selection to underscore.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_user_model_selection s
  SET model_pk = p.us_id
  FROM pairs p
  WHERE s.model_pk = p.dash_id;

  -- ai_usage_months: merge counters where both exist.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  ), dup AS (
    SELECT um_dash.id AS dash_row_id,
           um_us.id AS us_row_id,
           um_dash.requests_used,
           um_dash.input_units_used,
           um_dash.output_units_used
    FROM public.ai_usage_months um_dash
    JOIN pairs p ON p.dash_id = um_dash.model_pk
    JOIN public.ai_usage_months um_us
      ON um_us.user_id = um_dash.user_id
     AND um_us.month = um_dash.month
     AND um_us.model_pk = p.us_id
  )
  UPDATE public.ai_usage_months um
  SET requests_used = um.requests_used + d.requests_used,
      input_units_used = um.input_units_used + d.input_units_used,
      output_units_used = um.output_units_used + d.output_units_used,
      updated_at = now()
  FROM dup d
  WHERE um.id = d.us_row_id;

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  DELETE FROM public.ai_usage_months um
  USING pairs p
  WHERE um.model_pk = p.dash_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_usage_months um_us
      WHERE um_us.user_id = um.user_id
        AND um_us.month = um.month
        AND um_us.model_pk = p.us_id
    );

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_usage_months um
  SET model_pk = p.us_id
  FROM pairs p
  WHERE um.model_pk = p.dash_id;

  -- ai_usage_events: move requested/used references.
  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_usage_events ev
  SET model_pk_requested = p.us_id
  FROM pairs p
  WHERE ev.model_pk_requested = p.dash_id;

  WITH pairs AS (
    SELECT dash.id AS dash_id, us.id AS us_id
    FROM public.ai_models dash
    JOIN public.ai_models us ON us.model_id = replace(dash.model_id, '-', '_')
    WHERE dash.model_id LIKE '%-%'
  )
  UPDATE public.ai_usage_events ev
  SET model_pk_used = p.us_id
  FROM pairs p
  WHERE ev.model_pk_used = p.dash_id;

  -- Disable dashed models when underscore exists.
  UPDATE public.ai_models m
  SET status = 'disabled',
      updated_at = now()
  WHERE m.model_id LIKE '%-%'
    AND EXISTS (
      SELECT 1
      FROM public.ai_models m2
      WHERE m2.model_id = replace(m.model_id, '-', '_')
    );
END $$;

