BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO public.edge_exam_sync_inbox(
  event_id,user_id,session_id,stream_version,event_type,payload,occurred_at
) VALUES (
  'checkpoint-standard-1',
  'cc000000-0000-0000-0000-000000000001',
  'cc000000-0000-0000-0000-000000000101',
  26,
  'session.checkpoint',
  '{
    "session_id":"cc000000-0000-0000-0000-000000000101",
    "session_type":"standard",
    "version":26,
    "answers":[
      {"question_id":700001,"selected_option_id":710001,"is_correct":true,"time_spent_seconds":11,"revision":1,"answered_at":"2026-09-19T10:00:00Z"},
      {"question_id":700002,"selected_option_id":710002,"is_correct":false,"time_spent_seconds":12,"revision":1,"answered_at":"2026-09-19T10:01:00Z"}
    ]
  }'::jsonb,
  '2026-09-19T10:02:00Z'
);

SELECT extensions.is(
  (SELECT version FROM public.edge_exam_sessions WHERE session_id='cc000000-0000-0000-0000-000000000101'),
  26::bigint,
  'checkpoint advances the slim edge session version'
);

SELECT extensions.is(
  (SELECT answered_question_ids FROM public.edge_exam_sessions WHERE session_id='cc000000-0000-0000-0000-000000000101'),
  ARRAY[700001,700002]::bigint[],
  'checkpoint materializes the full answered-question snapshot'
);

SELECT extensions.is(
  (SELECT answer_state FROM public.edge_user_question_state
   WHERE user_id='cc000000-0000-0000-0000-000000000001' AND question_id=700001),
  'correct',
  'standard checkpoint materializes correct user-question state'
);

SELECT extensions.is(
  (SELECT answer_state FROM public.edge_user_question_state
   WHERE user_id='cc000000-0000-0000-0000-000000000001' AND question_id=700002),
  'incorrect',
  'standard checkpoint materializes incorrect user-question state'
);

SELECT extensions.ok(
  (SELECT processed_at IS NOT NULL FROM public.edge_exam_sync_inbox WHERE event_id='checkpoint-standard-1'),
  'generic inbox materializer still marks checkpoint events processed'
);

INSERT INTO public.edge_exam_sync_inbox(
  event_id,user_id,session_id,stream_version,event_type,payload,occurred_at
) VALUES (
  'checkpoint-standard-stale',
  'cc000000-0000-0000-0000-000000000001',
  'cc000000-0000-0000-0000-000000000101',
  20,
  'session.checkpoint',
  '{
    "session_id":"cc000000-0000-0000-0000-000000000101",
    "session_type":"standard",
    "version":20,
    "answers":[
      {"question_id":700001,"selected_option_id":710099,"is_correct":false,"time_spent_seconds":5,"revision":1,"answered_at":"2026-09-19T09:00:00Z"}
    ]
  }'::jsonb,
  '2026-09-19T09:01:00Z'
);

SELECT extensions.is(
  (SELECT answered_question_ids FROM public.edge_exam_sessions WHERE session_id='cc000000-0000-0000-0000-000000000101'),
  ARRAY[700001,700002]::bigint[],
  'older checkpoint cannot regress the session answered-question snapshot'
);

SELECT extensions.is(
  (SELECT answer_state FROM public.edge_user_question_state
   WHERE user_id='cc000000-0000-0000-0000-000000000001' AND question_id=700001),
  'correct',
  'older checkpoint cannot regress a newer training answer state'
);

INSERT INTO public.edge_exam_sync_inbox(
  event_id,user_id,session_id,stream_version,event_type,payload,occurred_at
) VALUES (
  'checkpoint-timed-1',
  'cc000000-0000-0000-0000-000000000002',
  'cc000000-0000-0000-0000-000000000202',
  12,
  'session.checkpoint',
  '{
    "session_id":"cc000000-0000-0000-0000-000000000202",
    "session_type":"timed",
    "version":12,
    "answers":[
      {"question_id":700003,"selected_option_id":710003,"is_correct":null,"time_spent_seconds":17,"revision":1,"answered_at":"2026-09-19T10:05:00Z"}
    ]
  }'::jsonb,
  '2026-09-19T10:06:00Z'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.edge_user_question_state
   WHERE user_id='cc000000-0000-0000-0000-000000000002' AND question_id=700003),
  0,
  'timed checkpoint does not materialize correctness before completion'
);

SELECT * FROM extensions.finish();
ROLLBACK;
