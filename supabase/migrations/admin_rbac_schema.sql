CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.admin_user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'app_settings'
      AND c.relkind = 'r'
  ) THEN
    BEGIN
      CREATE TRIGGER trg_app_settings_updated_at
      BEFORE UPDATE ON public.app_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur
    JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = uid
      AND r.key IN ('admin', 'super_admin')
  );
$$;

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_roles_select_auth ON public.admin_roles;
CREATE POLICY admin_roles_select_auth
ON public.admin_roles
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS admin_permissions_select_auth ON public.admin_permissions;
CREATE POLICY admin_permissions_select_auth
ON public.admin_permissions
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS admin_role_permissions_select_auth ON public.admin_role_permissions;
CREATE POLICY admin_role_permissions_select_auth
ON public.admin_role_permissions
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS admin_user_roles_select_self ON public.admin_user_roles;
CREATE POLICY admin_user_roles_select_self
ON public.admin_user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_user_roles_write_admin ON public.admin_user_roles;
CREATE POLICY admin_user_roles_write_admin
ON public.admin_user_roles
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS app_settings_admin_only ON public.app_settings;
CREATE POLICY app_settings_admin_only
ON public.app_settings
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS audit_logs_select_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_admin
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS audit_logs_insert_admin ON public.audit_logs;
CREATE POLICY audit_logs_insert_admin
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS profiles_insert_admin ON public.profiles;
CREATE POLICY profiles_insert_admin
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_select_public_enabled ON public.feature_flags;
CREATE POLICY feature_flags_select_public_enabled
ON public.feature_flags
FOR SELECT
TO anon
USING (is_enabled = true);

DROP POLICY IF EXISTS feature_flags_select_auth_enabled ON public.feature_flags;
CREATE POLICY feature_flags_select_auth_enabled
ON public.feature_flags
FOR SELECT
TO authenticated
USING (is_enabled = true OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS feature_flags_write_admin ON public.feature_flags;
CREATE POLICY feature_flags_write_admin
ON public.feature_flags
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.admin_roles (key, name)
VALUES
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_permissions (key, name)
VALUES
  ('manage_users', 'Manage users'),
  ('manage_roles', 'Manage roles'),
  ('manage_settings', 'Manage app settings'),
  ('manage_flags', 'Manage feature flags'),
  ('view_audit_logs', 'View audit logs')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.key IN ('super_admin', 'admin')
ON CONFLICT DO NOTHING;

