UPDATE public.profiles SET role = 'student' WHERE role IS NULL;
UPDATE public.profiles SET subscription_tier = 'free_trial' WHERE subscription_tier IS NULL;
UPDATE public.profiles SET is_active = TRUE WHERE is_active IS NULL;

ALTER TABLE public.profiles
    ALTER COLUMN role SET NOT NULL,
    ALTER COLUMN subscription_tier SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL;
