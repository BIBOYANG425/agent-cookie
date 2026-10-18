// Builds a self-contained dist/ for npm: no dependency on @agent-cookie/contract, which is private to this repo and
// publishes TypeScript source.
//   1. declarations of the SDK (dist/*.d.ts) and of the contract (dist/contract/*.d.ts), type-checked;
//   2. the SDK's imports of '@agent-cookie/contract' in those declarations point at dist/contract instead;
//   3. one ESM bundle (dist/index.js) with the contract's runtime constants inlined;
//   4. a check that nothing in dist still names an @agent-cookie package.
import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const tsc = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return out;
}

await rm(dist, { recursive: true, force: true });
for (const project of ['tsconfig.build.json', 'tsconfig.contract.json']) {
  try { execFileSync(tsc, ['-p', project], { cwd: root, stdio: 'inherit' }); }
  catch { console.error(`build: tsc -p ${project} failed`); process.exit(1); }
}

const contractIndex = join(dist, 'contract', 'index.js');
for (const file of await files(dist)) {
  if (!file.endsWith('.d.ts') || file.startsWith(join(dist, 'contract') + sep)) continue;
  let target = relative(dirname(file), contractIndex).split(sep).join('/');
  if (!target.startsWith('.')) target = `./${target}`;
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/(["'])@agent-cookie\/contract\1/g, `$1${target}$1`));
}

await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(dist, 'index.js'), bundle: true, platform: 'node', format: 'esm',
  target: 'node22', sourcemap: true, logLevel: 'warning' });

await build({ entryPoints: [join(root, 'src/hana-identifiers.ts')], outfile: join(dist, 'hana-identifiers.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true });

// A module specifier naming an @agent-cookie package (comments may mention the names; imports may not).
const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])@agent-cookie\//;
const leaks = [];
for (const file of await files(dist)) {
  if (file.endsWith('.map')) continue; // sourcesContent quotes the TypeScript source, imports included
  if (specifier.test(await readFile(file, 'utf8'))) leaks.push(relative(root, file));
}
if (leaks.length) {
  console.error(`build: dist still refers to an @agent-cookie package: ${leaks.join(', ')}`);
  process.exit(1);
}
