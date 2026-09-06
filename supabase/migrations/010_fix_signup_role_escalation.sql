-- Never trust role metadata supplied by a registering client.
-- New accounts always start as students; role elevation is an administrative action.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, subscription_tier)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        'student',
        'free_trial'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;
