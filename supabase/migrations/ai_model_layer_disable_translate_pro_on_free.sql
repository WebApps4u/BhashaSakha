-- Make translate_pro a paid-tier model by default (disable for free plan).

UPDATE public.ai_plan_entitlements e
SET is_enabled = false
FROM public.ai_models m
WHERE e.model_pk = m.id
  AND e.plan_code = 'free'
  AND m.model_id = 'translate_pro';

