-- Update translate_pro mapping to a currently supported Gemini model.

DO $$
DECLARE
  v_gemini uuid;
  v_pro uuid;
BEGIN
  SELECT id INTO v_gemini FROM public.ai_providers WHERE key = 'gemini' LIMIT 1;
  SELECT id INTO v_pro FROM public.ai_models WHERE model_id = 'translate_pro' LIMIT 1;

  IF v_gemini IS NOT NULL AND v_pro IS NOT NULL THEN
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    VALUES (v_pro, v_gemini, 'gemini-2.5-pro', 'active')
    ON CONFLICT (model_pk, provider_id) DO UPDATE
    SET provider_model_name = EXCLUDED.provider_model_name,
        status = EXCLUDED.status;
  END IF;
END $$;

