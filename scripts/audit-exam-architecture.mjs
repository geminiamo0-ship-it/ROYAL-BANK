#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const removedLegacyPaths = [
  'src/actions/exam-feedback.ts',
  'src/components/exam/ExamPageClient.tsx',
  'src/components/exam/ExamSidebarWidgets.tsx',
  'src/components/exam/RichNotesEditor.tsx',
  'src/components/exam/useExamTimer.ts',
  'src/stores/examStore.ts',
];

for (const relativePath of removedLegacyPaths) {
  try {
    await fs.access(path.join(root, relativePath));
    failures.push(`${relativePath}: retired exam implementation/helper must remain removed`);
  } catch {
    // Expected: these files belong to retired or abandoned exam paths.
  }
}

const examPagePath = path.join(root, 'src/app/(student)/exam/[sessionId]/page.tsx');
const examPage = await fs.readFile(examPagePath, 'utf8');
if (!examPage.includes("@/components/exam/WindowedExamPageClient")) {
  failures.push('exam route: production exam page must use the windowed exam engine');
}
if (examPage.includes('@/components/exam/ExamPageClient')) {
  failures.push('exam route: legacy full-load ExamPageClient reference detected');
}

const windowedClientPath = path.join(root, 'src/components/exam/WindowedExamPageClient.tsx');
const windowedClient = await fs.readFile(windowedClientPath, 'utf8');
const requiredWindowedBoundaries = [
  ['@/components/exam/WindowedExamQuestionPane', 'question presentation'],
  ['@/components/exam/useExamKeyboardShortcuts', 'keyboard behavior'],
  ['@/components/exam/useExamConceptBookmark', 'concept bookmark behavior'],
  ['@/components/exam/useWindowedExamSession', 'session loading/window navigation'],
  ['@/lib/exam-html', 'media/stem HTML normalization'],
];
for (const [modulePath, responsibility] of requiredWindowedBoundaries) {
  if (!windowedClient.includes(modulePath)) {
    failures.push(`windowed exam: ${responsibility} must stay extracted from the controller`);
  }
}
if (windowedClient.includes('@/components/exam/AnswerOptionList')) {
  failures.push('windowed exam: controller must not render answer options directly');
}
if (windowedClient.includes('getExamSessionBootstrapDirect')) {
  failures.push('windowed exam: bootstrap loading must stay inside useWindowedExamSession');
}
if (windowedClient.includes('getExamSessionWindowDirect')) {
  failures.push('windowed exam: question window loading must stay inside useWindowedExamSession');
}

const trainingSubmissionPath = path.join(root, 'src/components/exam/useExamTrainingSubmission.ts');
const trainingSubmission = await fs.readFile(trainingSubmissionPath, 'utf8');
const acceptedFreezeIndex = trainingSubmission.indexOf('acceptedOperationsRef.current.set(questionId, operation)');
const acceptedRenderIndex = trainingSubmission.indexOf('setAnswers((previous) => ({', acceptedFreezeIndex);
const acceptedEnqueueIndex = trainingSubmission.indexOf('answerQueue.enqueue(operation)', acceptedFreezeIndex);
if (acceptedFreezeIndex < 0 || acceptedRenderIndex < 0 || acceptedEnqueueIndex < 0) {
  failures.push('exam retry recovery: accepted training operation must be pinned, rendered, and enqueued explicitly');
} else if (!(acceptedFreezeIndex < acceptedRenderIndex && acceptedRenderIndex < acceptedEnqueueIndex)) {
  failures.push('exam retry recovery: training selection must be frozen in UI before the accepted operation is enqueued');
}
if (!trainingSubmission.includes('const operation = getAcceptedOperation(questionId);')) {
  failures.push('exam retry recovery: feedback retry must resolve the pinned accepted operation, not the latest pending selection');
}

const retrySaveStart = trainingSubmission.indexOf('const retrySave = useCallback((questionId: number) => {');
const retrySaveEnd = trainingSubmission.indexOf('\n  const submitAnswer = useCallback', retrySaveStart);
if (retrySaveStart < 0 || retrySaveEnd < 0) {
  failures.push('exam retry recovery: independent retrySave callback must exist');
} else {
  const retrySaveBody = trainingSubmission.slice(retrySaveStart, retrySaveEnd);
  if (!retrySaveBody.includes('answerQueue.retryPending(questionId)')) {
    failures.push('exam retry recovery: retrySave must reuse the exact pending answer operation');
  }
  if (retrySaveBody.includes('isFeedbackLockedMode')) {
    failures.push('exam retry recovery: timed/fixed_timed save retry must not be blocked by feedback mode');
  }
}

const questionPanePath = path.join(root, 'src/components/exam/WindowedExamQuestionPane.tsx');
const questionPane = await fs.readFile(questionPanePath, 'utf8');
if (!questionPane.includes('onClick={onRetrySave}')) {
  failures.push('exam retry recovery: Retry save button must use its dedicated persistence callback');
}
if (!windowedClient.includes('onRetrySave={() => retrySave(currentQ.id)}')) {
  failures.push('exam retry recovery: controller must wire Retry save directly to the mode-agnostic retrySave callback');
}
if (!windowedClient.includes('onRetryFeedback={() => retryFeedback(currentQ.id)}')) {
  failures.push('exam retry recovery: explanation retry must resolve the accepted operation inside the submission hook');
}
if (!windowedClient.includes('retryFlagPending(currentQ.id)')) {
  failures.push('exam flag recovery: current failed flag write must expose an explicit retry action');
}

const flagPersistencePath = path.join(root, 'src/components/exam/useExamFlagPersistence.ts');
const flagPersistence = await fs.readFile(flagPersistencePath, 'utf8');
for (const invariant of [
  'royal.exam.pending-flags:',
  'failedQuestionIds',
  'retryPending',
  'Promise.allSettled',
]) {
  if (!flagPersistence.includes(invariant)) {
    failures.push(`exam flag recovery: missing ${invariant} recovery invariant`);
  }
}

const windowSessionPath = path.join(root, 'src/components/exam/useWindowedExamSession.ts');
const windowSession = await fs.readFile(windowSessionPath, 'utf8');
if (!windowSession.includes('const overlapping = [...inFlightWindowsRef.current.values()]')) {
  failures.push('exam window loading: overlapping in-flight ranges must be coalesced before another fetch');
}
if (!windowSession.includes('await Promise.allSettled(overlapping.map((entry) => entry.promise))')) {
  failures.push('exam window loading: overlapping ranges must settle before the cache is re-evaluated');
}

const launchCachePath = path.join(root, 'src/lib/exam-launch-cache.ts');
const launchCache = await fs.readFile(launchCachePath, 'utf8');
if (!launchCache.includes('launchCache.delete(sessionId)')) {
  failures.push('exam launch cache: bootstrap handoff must remain one-shot');
}

const clientApiPath = path.join(root, 'src/lib/exam-client-api.ts');
const clientApi = await fs.readFile(clientApiPath, 'utf8');
if (!clientApi.includes('royal.exam.pending-create-request-ids')) {
  failures.push('exam create recovery: request id must survive a lost create/bootstrap response');
}
const createClearIndex = clientApi.indexOf('clearCreateRequestId(requestKey);');
const createNormalizeIndex = clientApi.indexOf('const bootstrap = normalizeExamBootstrap(data);');
if (createClearIndex < 0 || createNormalizeIndex < 0 || createClearIndex < createNormalizeIndex) {
  failures.push('exam create recovery: create request id may only be cleared after a complete bootstrap is normalized');
}

const r2ContentPath = path.join(root, 'src/lib/exam-r2-content.ts');
const r2Content = await fs.readFile(r2ContentPath, 'utf8');
for (const invariant of [
  "create: 'create_exam_session_bootstrap_idempotent_v3'",
  "bootstrap: 'get_exam_session_bootstrap_ref_v3'",
  "window: 'get_exam_session_window_refs_v2'",
  'contentReleaseId: string | null',
  'correct_option_id: number',
  'option_percentages: Record<string, number>',
]) {
  if (!r2Content.includes(invariant)) {
    failures.push(`exam content pinning: missing ${invariant}`);
  }
}
if (r2Content.includes('legacyContentPrefix') || r2Content.includes('DEFAULT_LEGACY_PREFIX')) {
  failures.push('exam content pinning: pinned session reads must not silently fall back to a legacy mutable generation');
}

const windowAccessPath = path.join(root, 'src/lib/exam-window-access.ts');
const windowAccess = await fs.readFile(windowAccessPath, 'utf8');
if (!windowAccess.includes('v: 2;') || !windowAccess.includes('r: string | null;')) {
  failures.push('exam window capability: signed token must bind the content release');
}
if (!windowAccess.includes("royal-exam-window-access-v2")) {
  failures.push('exam window capability: v2 release-bound tokens require a distinct signing context');
}

const windowFastPathPath = path.join(root, 'src/lib/exam-window-fast-path.ts');
const windowFastPath = await fs.readFile(windowFastPathPath, 'utf8');
if (!windowFastPath.includes('if (!access.r) return null;')) {
  failures.push('exam rollout: explicit legacy window capabilities must bypass the pinned R2 fast path');
}

const gatewayContractPath = path.join(root, 'src/lib/exam-gateway-contract.ts');
const gatewayContract = await fs.readFile(gatewayContractPath, 'utf8');
if (!gatewayContract.includes("create: 'create_exam_session_bootstrap_idempotent_v3'")) {
  failures.push('exam gateway: create must use the release-aware v3 RPC');
}
if (!gatewayContract.includes("bootstrap: 'get_exam_session_bootstrap_v3'")) {
  failures.push('exam gateway: bootstrap must use the release-aware v3 RPC');
}

const gatewayRoutePath = path.join(root, 'src/app/api/exam/route.ts');
const gatewayRoute = await fs.readFile(gatewayRoutePath, 'utf8');
if (!gatewayRoute.includes("@/lib/exam-gateway-server")) {
  failures.push('exam gateway: auth/proof/error helpers must stay outside the route orchestrator');
}
if (gatewayRoute.includes("from 'node:crypto'")) {
  failures.push('exam gateway: crypto/proof implementation must stay in the server helper module');
}
for (const invariant of [
  'EXAM_REQUEST_BUDGET_MS',
  'withinRequestBudget(requestDeadline',
  'resolveActiveExamContentRelease()',
  "EXAM_CONTENT_UNAVAILABLE",
  'feedback_pending: true',
  "const RELEASE_PIN_ACTIONS = new Set<ExamGatewayAction>(['create']);",
  "type ContentReleaseState = 'pinned' | 'legacy' | 'invalid';",
  "releaseState === 'legacy' && body.action !== 'create'",
]) {
  if (!gatewayRoute.includes(invariant)) {
    failures.push(`exam gateway: missing ${invariant} deadline/content consistency invariant`);
  }
}
if (gatewayRoute.includes("releaseState === 'pinned' &&") && gatewayRoute.includes('callRpc(legacyRpcName')) {
  failures.push('exam content pinning: pinned sessions must never enter the legacy live-content fallback branch');
}

const r2SyncPath = path.join(root, 'scripts/sync-exam-content-to-r2.mjs');
const r2Sync = await fs.readFile(r2SyncPath, 'utf8');
for (const invariant of [
  'is_correct,percentage',
  "register_exam_content_release",
  "register_exam_content_release_answers",
  "finalize_exam_content_release",
  'schema_version: 3',
]) {
  if (!r2Sync.includes(invariant)) {
    failures.push(`exam content publishing: missing ${invariant}`);
  }
}
const releaseFinalizeIndex = r2Sync.indexOf("finalize_exam_content_release");
const activePointerWriteIndex = r2Sync.indexOf('await r2PutJson(activeKey, activeRaw);');
if (releaseFinalizeIndex < 0 || activePointerWriteIndex < 0 || releaseFinalizeIndex > activePointerWriteIndex) {
  failures.push('exam content publishing: DB answer-key snapshot must finalize before the R2 active pointer switches');
}

const migration065Path = path.join(root, 'supabase/migrations/065_exam_release_pinning_and_deadlines.sql');
const migration065 = await fs.readFile(migration065Path, 'utf8');
for (const invariant of [
  'private.exam_content_releases',
  'private.exam_content_release_answers',
  'content_release_id',
  'EXAM_DEADLINE_EXPIRED',
  "'create_exam_session_bootstrap_idempotent_v3'",
  "'submit_exam_answer_with_feedback_ref_idempotent_v2'",
  "'renew_exam_window_access'",
]) {
  if (!migration065.includes(invariant)) {
    failures.push(`exam DB hardening: migration 065 is missing ${invariant}`);
  }
}

const migration066Path = path.join(root, 'supabase/migrations/066_preserve_legacy_exam_sessions.sql');
const migration066 = await fs.readFile(migration066Path, 'utf8');
for (const invariant of [
  'private.augment_exam_bootstrap_existing_release',
  'public.get_exam_session_bootstrap_v3',
  'public.get_exam_session_bootstrap_ref_v3',
  'public.get_completed_exam_review_bootstrap_ref_v2',
]) {
  if (!migration066.includes(invariant)) {
    failures.push(`exam rollout compatibility: migration 066 is missing ${invariant}`);
  }
}
if (migration066.includes('private.pin_exam_session_content_release(')) {
  failures.push('exam rollout compatibility: resume/review migration must never pin a legacy session');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

for (const file of await walk(path.join(root, 'src'))) {
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
  const content = await fs.readFile(file, 'utf8');
  const relativePath = path.relative(root, file).replaceAll(path.sep, '/');

  if (content.includes('@/stores/examStore')) {
    failures.push(`${relativePath}: legacy exam store import detected`);
  }
  if (content.includes('@/actions/exam-feedback')) {
    failures.push(`${relativePath}: legacy exam feedback action import detected`);
  }
  if (content.includes('@/components/exam/ExamPageClient')) {
    failures.push(`${relativePath}: legacy full-load exam client import detected`);
  }
  if (content.includes('@/components/exam/ExamSidebarWidgets')) {
    failures.push(`${relativePath}: legacy full-load exam sidebar import detected`);
  }
}

if (failures.length > 0) {
  console.error(`Exam architecture audit failed (${failures.length} finding${failures.length === 1 ? '' : 's'}):`);
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Exam architecture audit passed: windowing, retry recovery, release pinning, legacy rollout isolation, gateway deadlines, and BFF boundaries remain enforced.');