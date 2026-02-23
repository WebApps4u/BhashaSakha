ALTER TABLE public.subscription_plans
ADD COLUMN IF NOT EXISTS per_request_char_limit integer NOT NULL DEFAULT 0;

ALTER TABLE public.subscription_plans
ADD COLUMN IF NOT EXISTS max_targets integer NOT NULL DEFAULT 0;

ALTER TABLE public.user_subscriptions
ADD COLUMN IF NOT EXISTS override_per_request_char_limit integer;

ALTER TABLE public.user_subscriptions
ADD COLUMN IF NOT EXISTS override_max_targets integer;

UPDATE public.subscription_plans
SET per_request_char_limit = CASE code
  WHEN 'free' THEN 2000
  WHEN 'pro' THEN 20000
  ELSE per_request_char_limit
END,
max_targets = CASE code
  WHEN 'free' THEN 3
  WHEN 'pro' THEN 10
  ELSE max_targets
END
WHERE code IN ('free', 'pro');

