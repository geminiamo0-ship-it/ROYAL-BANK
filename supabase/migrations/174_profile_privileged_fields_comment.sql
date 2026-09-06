COMMENT ON COLUMN public.profiles.role IS
'Privileged authorization field. Mutate only through admin_update_user_access().';
COMMENT ON COLUMN public.profiles.subscription_tier IS
'Privileged subscription summary field. Mutate only through trusted admin workflows.';
COMMENT ON COLUMN public.profiles.is_active IS
'Privileged account-status field. Inactive accounts are denied protected data access by RLS/helpers.';
