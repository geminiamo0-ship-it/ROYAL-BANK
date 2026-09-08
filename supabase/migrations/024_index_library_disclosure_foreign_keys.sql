CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_bank_user
    ON private.library_article_disclosures(question_bank_id, user_id);

CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_article
    ON private.library_article_disclosures(article_id);
