# Application Integration Checklist

- [ ] Fetch full current `create_exam_session` definition.
- [ ] Make session creation authorize bank config/pathway access and lock mapped questions only.
- [ ] Update `startExamSession` to remove `bankId === 1` access assumption.
- [ ] Update answer save to `submit_exam_answer` and propagate errors.
- [ ] Update End Block to `complete_exam_session`.
- [ ] Update flag/unflag to `set_question_flag`.
- [ ] Update Question Bank state/count logic to canonical RPCs.
- [ ] Update Incorrect filter to latest-answer semantics.
- [ ] Update Suspended filter to unanswered locks.
- [ ] Verify session deletion/release behavior.
- [ ] Verify Previous Sessions/resume.
- [ ] Remove duplicate category constants and circular shared types.
