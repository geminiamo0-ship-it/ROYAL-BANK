-- ==============================================================================
-- ROYAL BANK - ROW LEVEL SECURITY (RLS) & STORED PROCEDURES
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pathway_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_blocklist ENABLE ROW LEVEL SECURITY;

-- Helper functions for Role checking
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_support_or_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'support')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Profiles Policies
CREATE POLICY "Users can view own profile or admins can view all"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_support_or_admin());

CREATE POLICY "Users can update own profile (restricted) or admin full update"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id OR public.is_admin());

-- 2. Pathways, Banks, Blocks, Questions, Options, Library Articles (Read-only for authenticated students, full CRUD for admin)
CREATE POLICY "Authenticated users can read pathways"
    ON public.pathways FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to pathways"
    ON public.pathways FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read question_banks"
    ON public.question_banks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to question_banks"
    ON public.question_banks FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read blocks"
    ON public.blocks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to blocks"
    ON public.blocks FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read questions"
    ON public.questions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to questions"
    ON public.questions FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read question_bank_questions"
    ON public.question_bank_questions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to question_bank_questions"
    ON public.question_bank_questions FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read options"
    ON public.options FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to options"
    ON public.options FOR ALL
    USING (public.is_admin());

CREATE POLICY "Authenticated users can read library_articles"
    ON public.library_articles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins have full access to library_articles"
    ON public.library_articles FOR ALL
    USING (public.is_admin());

-- 3. User Subscriptions / Pathway Access
CREATE POLICY "Users can view own pathway access, support/admin can view all"
    ON public.user_pathway_access FOR SELECT
    USING (auth.uid() = user_id OR public.is_support_or_admin());

CREATE POLICY "Support and Admin can insert/update pathway access"
    ON public.user_pathway_access FOR ALL
    USING (public.is_support_or_admin());

-- 4. Test Sessions & User Answers
CREATE POLICY "Users have full access to own test_sessions"
    ON public.test_sessions FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users have full access to own answers"
    ON public.user_answers FOR ALL
    USING (auth.uid() = user_id);

-- 5. User Notes & Saved Concepts
CREATE POLICY "Users have full access to own notes"
    ON public.user_notes FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users have full access to own saved concepts"
    ON public.saved_concepts FOR ALL
    USING (auth.uid() = user_id);

-- 6. Login History & IP Blocklist
CREATE POLICY "Users can view own login history, admins can view all"
    ON public.login_history FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "System/Users can insert login history"
    ON public.login_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins have full access to ip_blocklist"
    ON public.ip_blocklist FOR ALL
    USING (public.is_admin());

-- ==============================================================================
-- STORED PROCEDURES & ANALYTICS
-- ==============================================================================

-- Check if an IP is blocked
CREATE OR REPLACE FUNCTION public.is_ip_blocked(client_ip INET)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.ip_blocklist
        WHERE ip_address = client_ip
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Analytics: Get Category Heatmap & Performance for a user
CREATE OR REPLACE FUNCTION public.get_user_category_analytics(p_user_id UUID)
RETURNS TABLE (
    category TEXT,
    total_answered BIGINT,
    correct_count BIGINT,
    accuracy_percentage NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        q.category,
        COUNT(ua.id) AS total_answered,
        COUNT(CASE WHEN ua.is_correct THEN 1 END) AS correct_count,
        ROUND((COUNT(CASE WHEN ua.is_correct THEN 1 END)::NUMERIC / NULLIF(COUNT(ua.id), 0) * 100), 1) AS accuracy_percentage
    FROM public.user_answers ua
    JOIN public.questions q ON ua.question_id = q.id
    WHERE ua.user_id = p_user_id
    GROUP BY q.category
    ORDER BY total_answered DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
