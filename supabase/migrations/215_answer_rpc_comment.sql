COMMENT ON FUNCTION public.submit_exam_answer(UUID, BIGINT, BIGINT, INT) IS
'Mode-aware answer write boundary: Standard/Tutor insert once; Timed modes upsert until End Block. Database validates session/question/option and derives correctness.';
