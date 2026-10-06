-- Route the interview models to Gemini 2.5 Flash-Lite, which has a separate (much larger)
-- free-tier quota than Gemini 2.5 Flash (20 requests/day on the free tier).
-- Applied to production on 2026-10-06. Switch back to 'gemini-2.5-flash' once billing is enabled.

DO $$
DECLARE
  v_gemini uuid;
BEGIN
  SELECT id INTO v_gemini FROM public.ai_providers WHERE key = 'gemini' LIMIT 1;
  IF v_gemini IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ai_model_mappings mm
  SET provider_model_name = 'gemini-2.5-flash-lite'
  FROM public.ai_models m
  WHERE mm.model_pk = m.id
    AND mm.provider_id = v_gemini
    AND m.model_id IN ('interview_lite', 'interview_pro');
END $$;
