import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const forbidden = [
  'PATHWAYS_DATA',
  'CATALOG_CARDS',
  'INITIAL_CATEGORIES',
  'BANK_INFO',
  'SAMPLE_PERFORMANCE',
  'SAMPLE_THREADS',
  'SAMPLE_FACTS',
  'TOP_CONCEPTS',
  'CONCEPTS_LIST',
  'CONTENT_MAP_DATA',
  'MOCK_EXAMS',
  'SAMPLE_SAVED',
  'INITIAL_BLOCKED',
  'INITIAL_USERS',
  '/exam/review-',
  '/exam/mock-',
  'session-demo-',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await walk(sourceRoot)) {
  const content = await readFile(file, 'utf8');
  for (const marker of forbidden) {
    if (content.includes(marker)) violations.push(`${relative(root, file)} contains ${JSON.stringify(marker)}`);
  }
}

if (violations.length > 0) {
  console.error('Runtime mock audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Runtime mock audit passed.');
