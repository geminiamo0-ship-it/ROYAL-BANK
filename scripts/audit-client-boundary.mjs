#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const buildMode = process.argv.includes('--build');
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css']);

const forbidden = [
  { label: 'backend provider name', re: /supabase/i },
  { label: 'browser backend SDK', re: /createBrowserClient|@supabase\//i },
  { label: 'public backend env', re: /NEXT_PUBLIC_SUPABASE_/i },
  { label: 'direct REST endpoint', re: /\/rest\/v1/i },
  { label: 'direct auth endpoint', re: /\/auth\/v1/i },
  { label: 'direct storage endpoint', re: /\/storage\/v1/i },
  { label: 'direct realtime endpoint', re: /\/realtime\/v1/i },
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function isClientModule(content) {
  const prefix = content.slice(0, 500);
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['\"]use client['\"]\s*;?/m.test(prefix);
}

function inspect(file, content, failures) {
  for (const rule of forbidden) {
    if (rule.re.test(content)) failures.push(`${relative(file)}: ${rule.label}`);
  }
}

const failures = [];

if (!buildMode) {
  const removedPaths = [
    'src/lib/supabase/client.ts',
    'src/components/providers/SupabaseResourceHints.tsx',
  ];

  for (const removedPath of removedPaths) {
    try {
      await fs.access(path.join(root, removedPath));
      failures.push(`${removedPath}: forbidden browser-backend bridge still exists`);
    } catch {
      // Expected: the file is intentionally absent.
    }
  }

  for (const file of await walk(path.join(root, 'src'))) {
    if (!textExtensions.has(path.extname(file))) continue;
    const content = await fs.readFile(file, 'utf8');
    if (isClientModule(content)) inspect(file, content, failures);
  }
} else {
  const staticRoot = path.join(root, '.next', 'static');
  const files = await walk(staticRoot);
  if (files.length === 0) failures.push('.next/static: no build output found');

  for (const file of files) {
    if (!textExtensions.has(path.extname(file))) continue;
    inspect(file, await fs.readFile(file, 'utf8'), failures);
  }
}

if (failures.length) {
  console.error(`Client boundary audit failed (${failures.length} finding${failures.length === 1 ? '' : 's'}):`);
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(buildMode
  ? 'Client bundle audit passed: no direct backend-provider references found.'
  : 'Client source audit passed: browser code is Royal/Vercel-only.');
