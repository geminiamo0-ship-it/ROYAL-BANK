COMMENT ON COLUMN public.profiles.email IS
'Authentication identity email. Not mutable through profile self-service RPC; email changes must flow through Supabase Auth and an explicit sync path.';
