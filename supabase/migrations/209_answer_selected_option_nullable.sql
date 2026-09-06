COMMENT ON COLUMN public.user_answers.selected_option_id IS
'Nullable only for legacy/unanswered compatibility. New finalized answer writes should include a selected option; database derives correctness from it.';
