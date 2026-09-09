#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const removedLegacyPaths = [
  'src/components/exam/ExamPageClient.tsx',
  'src/components/exam/ExamSidebarWidgets.tsx',
  'src/components/exam/RichNotesEditor.tsx',
  'src/stores/examStore.ts',
];

for (const relativePath of removedLegacyPaths) {
  try {
    await fs.access(path.join(root, relativePath));
    failures.push(`${relativePath}: legacy exam implementation must remain removed`);
  } catch {
    // Expected: these files belonged to the retired full-load exam path.
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

console.log('Exam architecture audit passed: one windowed exam engine remains active.');
