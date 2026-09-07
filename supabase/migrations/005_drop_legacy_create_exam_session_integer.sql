-- Remove the legacy INTEGER overload of create_exam_session.
-- PostgREST cannot disambiguate JSON numeric arguments when both INTEGER and BIGINT
-- overloads exist with the same parameter names, causing exam creation to fail.

DROP FUNCTION IF EXISTS public.create_exam_session(
    UUID,
    INTEGER,
    TEXT,
    INTEGER,
    TEXT[],
    TEXT[],
    JSONB,
    TEXT
);

-- Keep PostgREST's function cache in sync after removing the overload.
NOTIFY pgrst, 'reload schema';
