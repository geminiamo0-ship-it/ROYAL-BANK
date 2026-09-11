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

const launchCachePath = path.join(root, 'src/lib/exam-launch-cache.ts');
const launchCache = await fs.readFile(launchCachePath, 'utf8');
if (!launchCache.includes('launchCache.delete(sessionId)')) {
  failures.push('exam launch cache: bootstrap handoff must remain one-shot');
}

const gatewayRoutePath = path.join(root, 'src/app/api/exam/route.ts');
const gatewayRoute = await fs.readFile(gatewayRoutePath, 'utf8');
if (!gatewayRoute.includes("@/lib/exam-gateway-server")) {
  failures.push('exam gateway: auth/proof/error helpers must stay outside the route orchestrator');
}
if (gatewayRoute.includes("from 'node:crypto'")) {
  failures.push('exam gateway: crypto/proof implementation must stay in the server helper module');
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

console.log('Exam architecture audit passed: one windowed exam engine with bounded controller responsibilities and retry invariants remains active.');
