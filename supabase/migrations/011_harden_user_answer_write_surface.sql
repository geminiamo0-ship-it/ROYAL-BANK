-- Keep exam answer state behind the audited RPC boundary.
--
-- The application submits answers through SECURITY DEFINER RPCs that enforce
-- authentication, ownership, bank access, session membership, answer finality,
-- and server-derived correctness. Direct table DML is unnecessary and widens
-- the attack surface (including any future misuse of transaction-local state
-- used by trusted finalization code).
--
-- SECURITY DEFINER RPCs continue to work because they execute with the function
-- owner's privileges. service_role/postgres privileges are intentionally left
-- unchanged.

REVOKE ALL PRIVILEGES ON TABLE public.user_answers FROM anon, authenticated;
