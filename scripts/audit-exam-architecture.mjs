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
if (!windowedClient.includes("@/components/exam/WindowedExamQuestionPane")) {
  failures.push('windowed exam: question presentation must stay extracted from the controller');
}
if (!windowedClient.includes("@/components/exam/useExamKeyboardShortcuts")) {
  failures.push('windowed exam: keyboard behavior must stay in the dedicated hook');
}
if (!windowedClient.includes("@/lib/exam-html")) {
  failures.push('windowed exam: media/stem HTML normalization must stay centralized');
}
if (windowedClient.includes("@/components/exam/AnswerOptionList")) {
  failures.push('windowed exam: controller must not render answer options directly');
}

const launchCachePath = path.join(root, 'src/lib/exam-launch-cache.ts');
const launchCache = await fs.readFile(launchCachePath, 'utf8');
if (!launchCache.includes('launchCache.delete(sessionId)')) {
  failures.push('exam launch cache: bootstrap handoff must remain one-shot');
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

console.log('Exam architecture audit passed: one windowed exam engine with bounded controller responsibilities remains active.');
