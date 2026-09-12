-- Preserve source topic metadata on library articles so library content can be
-- linked deterministically to QBank topics and, later, canonical Study Plan topics.

ALTER TABLE public.library_articles
    ADD COLUMN IF NOT EXISTS topic TEXT;

COMMENT ON COLUMN public.library_articles.topic IS
    'Source topic name associated with this article. Import-time metadata; stable topic_id linkage may be layered on later.';

CREATE INDEX IF NOT EXISTS idx_library_articles_category_topic
    ON public.library_articles(category, topic);
