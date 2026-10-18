#!/usr/bin/env node
// Proves `npm install @agent-cookie/sdk` works outside this repository: pack the package (prepack builds dist), check
// the tarball holds only dist/, README.md and package.json and declares no dependency, install it offline into an
// empty npm project, import every client from a plain Node script and construct each one against the default
// workspace URL with a fetch that refuses to run (no network call is made), then type-check a TypeScript consumer
// against the installed declarations. Any failure exits non-zero. KEEP_SMOKE_DIR=1 keeps the temporary directory.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(pkgDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const work = await mkdtemp(join(tmpdir(), 'agent-cookie-sdk-smoke-'));
const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const step = (text) => console.log(`pack-smoke: ${text}`);

const consumer = `import {
  AssistantClient, MerchantClient, WorkspaceClient, WorkspaceError, LinkNotApprovedError, assistantPrompt, isWorkspaceError,
  registerAgent, workspaceConfigFromEnv, WORKSPACE_ERROR_CODES, LINK_TTL_MS,
} from '@agent-cookie/sdk';
const refuse = async () => { throw new Error('pack-smoke: no network call is allowed'); };
const config = workspaceConfigFromEnv({ AGENT_COOKIE_URL: 'http://127.0.0.1:4310', AGENT_COOKIE_KEY: 'pack-smoke-key' });
const clients = [new WorkspaceClient({ ...config, fetch: refuse }), new AssistantClient({ ...config, fetch: refuse }),
  new MerchantClient({ ...config, fetch: refuse })];
for (const method of ['find', 'accept', 'listLinks', 'approveLink']) if (typeof clients[0][method] !== 'function') throw new Error('WorkspaceClient.' + method);
for (const method of ['requestLink', 'waitForLink', 'context', 'remember', 'stats', 'find', 'accept', 'observe']) {
  if (typeof clients[1][method] !== 'function') throw new Error('AssistantClient.' + method);
}
for (const method of ['handshake', 'fields', 'quote', 'contribute', 'getNote', 'setNote', 'stats']) {
  if (typeof clients[2][method] !== 'function') throw new Error('MerchantClient.' + method);
}
if (typeof registerAgent !== 'function' || typeof isWorkspaceError !== 'function') throw new Error('functions');
if (!WORKSPACE_ERROR_CODES.includes('LINK_NOT_PENDING') || LINK_TTL_MS !== 600000) throw new Error('constants');
const error = new WorkspaceError(409, 'LINK_NOT_PENDING');
if (!(error instanceof Error) || !isWorkspaceError(error, 'LINK_NOT_PENDING')) throw new Error('WorkspaceError');
if (typeof LinkNotApprovedError !== 'function') throw new Error('LinkNotApprovedError');
const prompt = assistantPrompt({ v: 1, sessionId: 's', policyId: 'p', fields: { lang: 'en' }, unknown: ['budget'], writable: [],
  expiresAt: '2026-11-17T00:00:00.000Z' });
if (!prompt.includes('- lang: en') || !prompt.includes('budget')) throw new Error('assistantPrompt');
console.log('pack-smoke: imported and constructed WorkspaceClient, AssistantClient, MerchantClient; assistantPrompt rendered '
  + prompt.split('\\n').length + ' lines; no network call');
`;

// Type-checked only, never run: the three quickstarts' calls against the installed declarations.
const typedConsumer = `import {
  AssistantClient, MerchantClient, WorkspaceClient, assistantPrompt, isWorkspaceError, registerAgent, workspaceConfigFromEnv,
  type AssistantContributionInput, type Field, type FieldsResult, type LinkView, type Registration,
} from '@agent-cookie/sdk';
export async function flow(): Promise<string> {
  const registration: Registration = await registerAgent('http://127.0.0.1:4310', { name: 'Smoke', category: 'assistant' });
  const assistant = new AssistantClient({ baseUrl: 'http://127.0.0.1:4310', key: registration.key });
  const link: LinkView = await assistant.requestLink();
  await assistant.waitForLink(link.id, { intervalMs: 2000, timeoutMs: 60000 });
  const context = await assistant.context();
  const found = await assistant.find({ text: 'trail running shoes', kind: 'shoes' }, 'find-1');
  if (found.quotes[0]) await assistant.accept(found.quotes[0].id, 'accept-1');
  const fact: AssistantContributionInput = { field: 'pref.brand', value: 'Brooks', basis: 'stated',
    evidence: { conversationId: 'chat-1', snippet: 'I only run in Brooks' } };
  await assistant.remember(fact);
  await assistant.remember({ field: 'pref.color', value: 'black' }); // basis omitted: observed, the contract default
  const stats = await assistant.stats();
  const merchant = new MerchantClient(workspaceConfigFromEnv({ AGENT_COOKIE_KEY: 'merchant-key' }));
  const available: Field[] = (await merchant.handshake('session')).available;
  let released: FieldsResult | undefined;
  try { released = await merchant.fields('session', ['payment_method'], 'payment'); }
  catch (error) { if (!isWorkspaceError(error, 'SCOPE_DENIED', 'PURPOSE_MISMATCH')) throw error; }
  const owner = new WorkspaceClient(workspaceConfigFromEnv({ AGENT_COOKIE_KEY: 'owner-key' }));
  const { links } = await owner.listLinks();
  return assistantPrompt(context) + available.length + String(released) + links.length + stats.questionsSkipped;
}
`;

let ok = false;
try {
  step(`packing into ${work}`);
  run('pnpm', ['pack', '--pack-destination', work], pkgDir);
  const tarball = (await readdir(work)).find(f => f.endsWith('.tgz'));
  if (!tarball) throw new Error('pnpm pack produced no tarball');
  const entries = run('tar', ['-tzf', join(work, tarball)]).trim().split('\n');
  const stray = entries.filter(e => !/^package\/(package\.json|README\.md|dist\/.+)$/.test(e));
  if (stray.length) throw new Error(`unexpected files in the tarball: ${stray.join(', ')}`);
  const manifest = JSON.parse(run('tar', ['-xzOf', join(work, tarball), 'package/package.json']));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (manifest[field] && Object.keys(manifest[field]).length) throw new Error(`the packed package.json declares ${field}: ${Object.keys(manifest[field]).join(', ')}`);
  }
  step(`${tarball}: ${entries.length} files (package.json, README.md, dist/), no runtime dependencies`);

  const app = join(work, 'app');
  await mkdir(app);
  run('npm', ['init', '-y'], app);
  run('npm', ['install', '--offline', '--ignore-scripts', join(work, tarball)], app);
  step('npm install of the tarball into an empty project: ok (offline)');

  await writeFile(join(app, 'smoke.mjs'), consumer);
  process.stdout.write(run(process.execPath, ['smoke.mjs'], app));

  await writeFile(join(app, 'smoke.mts'), typedConsumer);
  await writeFile(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ['smoke.mts'] }, null, 2));
  run(tsc, ['-p', app], app);
  step('TypeScript consumer type-checks against the installed declarations (skipLibCheck off, no @types/node)');
  ok = true;
} catch (error) {
  const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
  console.error(`pack-smoke: FAILED: ${error.message.split('\n')[0]}${detail ? `\n${detail}` : ''}`);
} finally {
  if (process.env.KEEP_SMOKE_DIR === '1') step(`kept ${work}`);
  else await rm(work, { recursive: true, force: true });
}
if (ok) step('passed');
process.exit(ok ? 0 : 1);
