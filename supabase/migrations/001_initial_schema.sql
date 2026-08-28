-- ==============================================================================
-- ROYAL BANK - SUPABASE SCHEMA DEFINITION (v2)
-- Medical Question Bank Platform
-- ==============================================================================

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. PROFILES (Extends Supabase Auth users)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    role TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin', 'support')),
    subscription_tier TEXT DEFAULT 'free_trial' CHECK (subscription_tier IN ('free_trial', 'premium_individual', 'premium_full')),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Trigger to auto-create profile on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, subscription_tier)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'role', 'student'),
        'free_trial'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 2. PATHWAYS (MRCP Part 1, MRCOG, MRCS, etc.)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.pathways (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    icon_url TEXT,
    is_free_trial_available BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 3. QUESTION BANKS (e.g. Bank A, Bank B inside a Pathway)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.question_banks (
    id BIGSERIAL PRIMARY KEY,
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 4. BLOCKS (Block System for Free/Paid sets - max 70 questions/block)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.blocks (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE CASCADE,
    max_questions INT DEFAULT 70,
    is_free BOOLEAN DEFAULT FALSE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 5. QUESTIONS (Core Questions Table)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.questions (
    id BIGSERIAL PRIMARY KEY,
    main_id BIGINT UNIQUE,
    text_html TEXT NOT NULL,
    explanation_html TEXT NOT NULL,
    category TEXT NOT NULL,
    topic TEXT,
    concept TEXT,
    concept_id TEXT,
    notes_id TEXT,
    difficulty TEXT DEFAULT '1',
    source TEXT DEFAULT 'PassMedicine',
    pm_question_id TEXT,
    concepts_json TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Question to Bank Mapping
CREATE TABLE IF NOT EXISTS public.question_bank_questions (
    id BIGSERIAL PRIMARY KEY,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES public.questions(id) ON DELETE CASCADE,
    UNIQUE(question_bank_id, question_id)
);

-- ==============================================================================
-- 6. OPTIONS (Answer Choices)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.options (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT REFERENCES public.questions(id) ON DELETE CASCADE,
    text_html TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE NOT NULL,
    option_order INT DEFAULT 0 NOT NULL,
    percentage REAL DEFAULT 0.0
);

-- ==============================================================================
-- 7. LIBRARY ARTICLES (Textbook Library - High-yield & Extended)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.library_articles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    content_html TEXT NOT NULL,
    source TEXT DEFAULT 'Pastest',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 8. USER PATHWAY ACCESS & SUBSCRIPTIONS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_pathway_access (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE CASCADE,
    access_type TEXT DEFAULT 'free_trial' CHECK (access_type IN ('free_trial', 'premium')),
    blocks_allowed INT DEFAULT 1,
    granted_by UUID REFERENCES public.profiles(id),
    granted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMPTZ
);

-- ==============================================================================
-- 9. TEST SESSIONS & PROGRESS TRACKING
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.test_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE SET NULL,
    session_type TEXT DEFAULT 'standard' CHECK (session_type IN ('standard', 'fixed_timed', 'mock_exam', 'review', 'quick_champion')),
    categories TEXT[],
    difficulty_filter TEXT[],
    question_selection TEXT DEFAULT 'new_only' CHECK (question_selection IN ('new_only', 'incorrect_only', 'all', 'flagged_only')),
    total_questions INT DEFAULT 0,
    time_limit_minutes INT,
    started_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMPTZ,
    score_percentage REAL,
    is_completed BOOLEAN DEFAULT FALSE
);

-- User Answer Attempts
CREATE TABLE IF NOT EXISTS public.user_answers (
    id BIGSERIAL PRIMARY KEY,
    test_session_id UUID REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option_id BIGINT REFERENCES public.options(id) ON DELETE SET NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    is_flagged BOOLEAN DEFAULT FALSE,
    time_spent_seconds INT DEFAULT 0,
    answered_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 10. USER NOTES & HIGHLIGHTS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_notes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES public.questions(id) ON DELETE CASCADE,
    note_html TEXT NOT NULL,
    highlights_json JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, question_id)
);

-- ==============================================================================
-- 11. SAVED CONCEPTS (Important / Less Important)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.saved_concepts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES public.questions(id) ON DELETE CASCADE,
    concept_text TEXT NOT NULL,
    is_important BOOLEAN DEFAULT TRUE,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, question_id)
);

-- ==============================================================================
-- 12. SECURITY & AUDITING (IP Tracking, Fingerprinting, Blocklist)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.login_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    login_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    is_suspicious BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.ip_blocklist (
    id BIGSERIAL PRIMARY KEY,
    ip_address INET UNIQUE NOT NULL,
    reason TEXT,
    blocked_by UUID REFERENCES public.profiles(id),
    blocked_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 13. PERFORMANCE INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_questions_category ON public.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON public.questions(topic);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_notes_id ON public.questions(notes_id);
CREATE INDEX IF NOT EXISTS idx_questions_main_id ON public.questions(main_id);

CREATE INDEX IF NOT EXISTS idx_options_question_id ON public.options(question_id);

CREATE INDEX IF NOT EXISTS idx_user_answers_user ON public.user_answers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_answers_question ON public.user_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_user_answers_session ON public.user_answers(test_session_id);

CREATE INDEX IF NOT EXISTS idx_test_sessions_user ON public.test_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_login_history_user ON public.login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_ip ON public.login_history(ip_address);

CREATE INDEX IF NOT EXISTS idx_saved_concepts_user ON public.saved_concepts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notes_user ON public.user_notes(user_id);
