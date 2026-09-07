-- Keep exam answer state writes behind the audited RPC boundary.
--
-- The application submits answers through SECURITY DEFINER RPCs that enforce
-- authentication, ownership, bank access, session membership, answer finality,
-- and server-derived correctness. Direct table writes are unnecessary and widen
-- the attack surface (including any future misuse of transaction-local state
-- used by trusted finalization code).
--
-- Preserve existing SELECT semantics for answer-history tests/flows. Only direct
-- mutation and table-management privileges are removed. SECURITY DEFINER RPCs
-- continue to work because they execute with the function owner's privileges.
-- service_role/postgres privileges are intentionally left unchanged.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE public.user_answers
FROM anon, authenticated;
