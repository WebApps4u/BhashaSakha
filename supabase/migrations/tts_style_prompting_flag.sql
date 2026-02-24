INSERT INTO public.feature_flags (key, description, is_enabled, config)
VALUES (
  'tts_style_prompting',
  'Enable TTS style prompting (Gemini). Config: {"allowed_plans":["free"|"pro"]}',
  true,
  '{"allowed_plans":["free","pro"]}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

