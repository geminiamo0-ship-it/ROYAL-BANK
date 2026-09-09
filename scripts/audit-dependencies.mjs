#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const declared = Object.keys(packageJson.dependencies || {});
const used = new Set();

// React DOM is a required Next/React runtime peer even when application source
// does not import it directly.
const indirectRuntimeDependencies = new Set(['react-dom']);

function packageRoot(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) {
    return null;
  }
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : null;
  }
  return specifier.split('/')[0];
}

function collectImports(content) {
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const rootName = packageRoot(match[1]);
      if (rootName) used.add(rootName);
    }
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

const scanRoots = [path.join(root, 'src'), path.join(root, 'scripts')];
for (const scanRoot of scanRoots) {
  for (const file of await walk(scanRoot)) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    collectImports(await fs.readFile(file, 'utf8'));
  }
}

for (const fileName of ['next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs']) {
  const filePath = path.join(root, fileName);
  try {
    collectImports(await fs.readFile(filePath, 'utf8'));
  } catch {
    // Optional root config file.
  }
}

const unused = declared.filter(
  (dependency) => !used.has(dependency) && !indirectRuntimeDependencies.has(dependency),
);

if (unused.length > 0) {
  console.error(`Dependency audit failed (${unused.length} unused runtime dependenc${unused.length === 1 ? 'y' : 'ies'}):`);
  for (const dependency of unused.sort()) console.error(`- ${dependency}`);
  process.exit(1);
}

console.log(`Dependency audit passed: all ${declared.length} runtime dependencies are used or required peers.`);
