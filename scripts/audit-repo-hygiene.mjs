#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const MAX_COMPONENT_BYTES = 24 * 1024;

const retiredPaths = [
  'public/file.svg',
  'public/globe.svg',
  'public/next.svg',
  'public/vercel.svg',
  'public/window.svg',
  'scripts/check_html.py',
  'scripts/finish_sync.py',
  'scripts/resilient_ingest.py',
  'src/app/data/bank/[bankId]/categories/route.ts',
  'src/components/bank/OldBlocksClient.tsx',
  'src/components/layout/UpgradeModal.tsx',
  'src/components/providers/QueryProvider.tsx',
  'src/lib/bank-question-rows.ts',
];

for (const relativePath of retiredPaths) {
  try {
    await fs.access(path.join(root, relativePath));
    failures.push(`${relativePath}: retired file must remain removed`);
  } catch {
    // Expected.
  }
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

const sourceFiles = await walk(path.join(root, 'src'));
for (const file of sourceFiles) {
  const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
  const extension = path.extname(file);
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) continue;

  const content = await fs.readFile(file, 'utf8');
  if (/force rebuild/i.test(content)) {
    failures.push(`${relativePath}: debug rebuild marker detected`);
  }
  if (content.includes('OldBlocksClient')) {
    failures.push(`${relativePath}: retired OldBlocksClient naming detected`);
  }
  if (content.includes('@/components/providers/QueryProvider')) {
    failures.push(`${relativePath}: unused global QueryProvider must not return`);
  }

  if (relativePath.startsWith('src/components/') && extension === '.tsx') {
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_COMPONENT_BYTES) {
      failures.push(
        `${relativePath}: component is ${byteLength} bytes; split components above ${MAX_COMPONENT_BYTES} bytes`,
      );
    }
  }
}

for (const file of await walk(path.join(root, 'scripts'))) {
  if (!/\.(?:py|mjs|js)$/.test(file)) continue;
  const content = await fs.readFile(file, 'utf8');
  const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
  if (/\b[A-Za-z]:\\/.test(content)) {
    failures.push(`${relativePath}: hard-coded Windows absolute path detected`);
  }
}

if (failures.length > 0) {
  console.error(`Repository hygiene audit failed (${failures.length} finding${failures.length === 1 ? '' : 's'}):`);
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Repository hygiene audit passed: retired files are absent and component sizes remain bounded.');
