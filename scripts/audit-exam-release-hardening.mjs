#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const migration067 = await fs.readFile(
  path.join(root, 'supabase/migrations/067_minimize_pinned_r2_ref_queries.sql'),
  'utf8',
);
const migration068 = await fs.readFile(
  path.join(root, 'supabase/migrations/068_validate_session_release_coverage.sql'),
  'utf8',
);

for (const fn of [
  'public.get_exam_question_feedback_ref_v2',
  'public.get_exam_training_feedback_ref_v2',
  'public.get_completed_exam_review_feedback_ref_v2',
]) {
  if (!migration067.includes(`CREATE OR REPLACE FUNCTION ${fn}`)) {
    failures.push(`067: missing minimal ref implementation ${fn}`);
  }
}

for (const forbidden of [
  'v_payload := public.get_exam_question_feedback_ref(',
  'v_payload := public.get_exam_training_feedback_ref(',
  'v_payload := public.get_completed_exam_review_feedback(',
]) {
  if (migration067.includes(forbidden)) {
    failures.push(`067: pinned ref still delegates to live content reader: ${forbidden}`);
  }
}

for (const required of [
  'private.exam_content_release_answers release_answer',
  'WHEN v_session.content_release_id IS NOT NULL THEN release_answer.correct_option_id',
  'WHERE v_session.content_release_id IS NULL',
]) {
  if (!migration067.includes(required)) {
    failures.push(`067: bootstrap release-snapshot invariant missing: ${required}`);
  }
}

for (const protectedField of [
  "'correct_option_id'",
  "'option_percentages'",
  "'explanation_html'",
]) {
  const feedbackStart = migration067.indexOf(
    'CREATE OR REPLACE FUNCTION public.get_exam_question_feedback_ref_v2',
  );
  const trainingStart = migration067.indexOf(
    'CREATE OR REPLACE FUNCTION public.get_exam_training_feedback_ref_v2',
  );
  const feedbackBody = migration067.slice(feedbackStart, trainingStart);
  if (feedbackBody.includes(protectedField)) {
    failures.push(`067: minimal answered-feedback ref must not return ${protectedField}`);
  }
}

for (const required of [
  'CONTENT_RELEASE_SESSION_MISMATCH',
  'LEFT JOIN private.exam_content_release_answers snapshot',
  'snapshot.question_id IS NULL',
]) {
  if (!migration068.includes(required)) {
    failures.push(`068: release coverage guard missing: ${required}`);
  }
}

if (!migration068.includes('RAISE EXCEPTION \'CONTENT_RELEASE_SESSION_MISMATCH\'')) {
  failures.push('068: release mismatch must abort the create transaction');
}

if (failures.length > 0) {
  console.error(`Exam release hardening audit failed (${failures.length} finding${failures.length === 1 ? '' : 's'}):`);
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Exam release hardening audit passed: pinned refs stay minimal and Create requires complete immutable release coverage.');