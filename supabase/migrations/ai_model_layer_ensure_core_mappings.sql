-- Ensure core provider mappings exist for translate_lite / translate_pro.

DO $$
DECLARE
  v_gemini uuid;
  v_openai uuid;
  v_lite uuid;
  v_pro uuid;
BEGIN
  SELECT id INTO v_gemini FROM public.ai_providers WHERE key = 'gemini' LIMIT 1;
  SELECT id INTO v_openai FROM public.ai_providers WHERE key = 'openai' LIMIT 1;
  SELECT id INTO v_lite FROM public.ai_models WHERE model_id = 'translate_lite' LIMIT 1;
  SELECT id INTO v_pro FROM public.ai_models WHERE model_id = 'translate_pro' LIMIT 1;

  IF v_gemini IS NOT NULL AND v_lite IS NOT NULL THEN
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    VALUES (v_lite, v_gemini, 'gemini-2.5-flash', 'active')
    ON CONFLICT (model_pk, provider_id) DO UPDATE
    SET provider_model_name = EXCLUDED.provider_model_name,
        status = EXCLUDED.status;
  END IF;

  IF v_gemini IS NOT NULL AND v_pro IS NOT NULL THEN
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    VALUES (v_pro, v_gemini, 'gemini-1.5-pro', 'active')
    ON CONFLICT (model_pk, provider_id) DO UPDATE
    SET provider_model_name = EXCLUDED.provider_model_name,
        status = EXCLUDED.status;
  END IF;

  IF v_openai IS NOT NULL AND v_lite IS NOT NULL THEN
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    VALUES (v_lite, v_openai, 'gpt-4o-mini', 'active')
    ON CONFLICT (model_pk, provider_id) DO UPDATE
    SET provider_model_name = EXCLUDED.provider_model_name,
        status = EXCLUDED.status;
  END IF;

  IF v_openai IS NOT NULL AND v_pro IS NOT NULL THEN
    INSERT INTO public.ai_model_mappings (model_pk, provider_id, provider_model_name, status)
    VALUES (v_pro, v_openai, 'gpt-4o-mini', 'active')
    ON CONFLICT (model_pk, provider_id) DO UPDATE
    SET provider_model_name = EXCLUDED.provider_model_name,
        status = EXCLUDED.status;
  END IF;
END $$;

