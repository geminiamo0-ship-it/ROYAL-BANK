UPDATE public.profiles SET role = 'student' WHERE role IS NULL;
UPDATE public.profiles SET subscription_tier = 'free_trial' WHERE subscription_tier IS NULL;
UPDATE public.profiles SET is_active = TRUE WHERE is_active IS NULL;
