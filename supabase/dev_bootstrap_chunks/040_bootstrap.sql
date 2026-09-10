SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

COMMENT ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
IS 'Service-role-only Royal Content Manager import. Upserts supplied questions, replaces options for supplied questions, and ensures bank mappings. Missing source questions remain untouched.';

COMMENT ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB)
IS 'Service-role-only Royal Content Manager import. Upserts supplied Library articles and bank mappings. Missing source articles remain untouched.';

COMMENT ON FUNCTION public.content_manager_refresh_counts()
IS 'Service-role-only post-import refresh for question_bank_topic_counts.';
