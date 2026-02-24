-- Patch deprecated Gemini model names that may be stored with a `models/` prefix.

DO $$
DECLARE
  v_gemini_provider_id uuid;
BEGIN
  SELECT id INTO v_gemini_provider_id
  FROM public.ai_providers
  WHERE key = 'gemini'
  LIMIT 1;

  IF v_gemini_provider_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ai_model_mappings
  SET provider_model_name = 'gemini-2.5-flash'
  WHERE provider_id = v_gemini_provider_id
    AND status = 'active'
    AND provider_model_name IN ('models/gemini-2.0-flash', 'gemini-2.0-flash');
END $$;

