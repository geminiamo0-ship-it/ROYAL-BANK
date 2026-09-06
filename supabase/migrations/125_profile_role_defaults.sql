ALTER TABLE public.profiles
    ALTER COLUMN role SET NOT NULL,
    ALTER COLUMN subscription_tier SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL;
