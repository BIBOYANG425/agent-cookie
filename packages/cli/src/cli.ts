import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import {
  WorkspaceClient, WorkspaceError, workspaceBase, workspaceConfigFromEnv,
  type FunnelReport, type KeyList, type LinkList, type LinkResult, type MintedKey, type PolicyDocument, type PolicyResult, type ShadowResult,
} from '@agent-cookie/sdk';
import { StartError, startWorkspace, type StartWorkspace } from './start.js';

interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

/** A local failure whose message is already safe to print: never a key, a file's contents or a raw upstream message. */
export class CliError extends Error {}

/** What `init` and the key commands touch outside the SDK client; tests replace each one. */
export interface CliDeps {
  /** A client for an explicit workspace and key (init: the owner key it found). */
  clientFor?: (baseUrl: string, key: string) => WorkspaceClient;
  /** True when GET <baseUrl>/healthz answers 2xx. */
  healthy?: (baseUrl: string) => Promise<boolean>;
  /** The contents of a file (init reads <data-dir>/owner.key); rejects when it cannot be read. */
  readText?: (path: string) => Promise<string>;
  /** Starts the workspace detached and resolves once it listens (init --start). */
  start?: StartWorkspace;
  homedir?: () => string;
}

const DEFAULT_URL = 'http://127.0.0.1:4310';
const AGENT_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const OWNER_KEY_MAX = 512;

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/healthz`, { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

/** A value as a POSIX shell word: bare when it is plain, else single-quoted. */
const shellWord = (v: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

/** The two lines an agent's environment needs. The only place a minted key is ever printed. */
function envLines(baseUrl: string, key: string): string {
  return `export AGENT_COOKIE_URL=${shellWord(baseUrl)}\nexport AGENT_COOKIE_KEY=${shellWord(key)}\n`;
}

function agentIdOption(value: string, flag: string): string {
  if (!AGENT_ID.test(value)) throw new CliError(`${flag} must be a lower-case id: a letter or digit, then up to 63 of a-z 0-9 _ . -`);
  return value;
}
function labelOption(value: string): string {
  if (!value.trim() || new TextEncoder().encode(value).length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new CliError('--label must be 1-200 bytes of text on one line.');
  }
  return value;
}
function baseOption(value: string): string {
  try { return workspaceBase(value); }
  catch { throw new CliError('The workspace URL must be https://, or http:// on 127.0.0.1 or localhost, with no trailing slash, query or credentials.'); }
}

export function formatKeys(list: KeyList): string {
  const head = `${sampleLabel(list.sample)}Keys · ${list.keys.length} key${list.keys.length === 1 ? '' : 's'}\n`;
  if (!list.keys.length) return `${head}No keys minted yet. Mint one: agent-cookie keys mint --agent <id> --role personal --label <text>\n`;
  return head + table(['agent id', 'role', 'label', 'created', 'revoked'],
    list.keys.map(k => [k.agentId, k.role, k.label, k.createdAt, k.revokedAt ?? '-']));
}

/** The one-time announcement of a minted key: who it is for, the two env lines, and the warning. */
function formatMinted(minted: MintedKey, baseUrl: string): string {
  return `${sampleLabel(minted.sample)}Minted a ${minted.role} key for ${clean(minted.agentId)} ("${clean(minted.label)}") at ${clean(minted.createdAt)}.\n`
    + 'It is shown here once and never again. Put these two lines in that agent\'s environment, never in a file you commit, a chat or a log:\n\n'
    + envLines(baseUrl, minted.key)
    + `\nRevoke it: agent-cookie keys revoke ${clean(minted.agentId)}\n`;
}

const SNIPPET = [
  "import { WorkspaceClient, workspaceConfigFromEnv } from '@agent-cookie/sdk';",
  'const me = new WorkspaceClient(workspaceConfigFromEnv(process.env));',
  "await me.remember({ field: 'shoe_size', value: 'EU 42' }); // something the person told you",
  'const card = await me.getMyCard();',
  'console.log(card);',
].join('\n');

const POLICY_FILE_MAX_BYTES = 64 * 1024;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
// Workspace text reaches a terminal: never let it carry control sequences.
const clean = (v: unknown) => String(v).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
const sampleLabel = (sample: boolean) => (sample ? 'Sample · ' : '');

function table(header: string[], rows: string[][]): string {
  const cells = [header, ...rows].map(row => row.map(clean));
  const widths = header.map((_, i) => Math.max(...cells.map(row => row[i].length)));
  return cells.map(row => row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(widths[i]))).join('  ')).join('\n') + '\n';
}

export function formatFunnel(report: FunnelReport): string {
  const head = `${report.sample ? 'Sample funnel' : 'Funnel'} · generated ${clean(report.generatedAt)} · ${report.rows.length} intent${report.rows.length === 1 ? '' : 's'}\n`;
  if (!report.rows.length) return `${head}No intents.\n`;
  const dash = (v: number | string | undefined) => (v === undefined ? '-' : String(v));
  return head + table(
    ['intent', 'time', 'introduced', 'quoted', 'first quote ms', 'accepted', 'outcome', 'fields read/granted', 'receipts', 'sellers picked/eligible'],
    report.rows.map(r => [r.intentId, r.createdAt, String(r.introduced), String(r.quoted), dash(r.firstQuoteMs), r.accepted ? 'yes' : 'no',
      dash(r.outcome), `${r.fieldsRead}/${r.fieldsGranted}`, String(r.purposeReleases),
      r.search ? `${r.search.picked}/${r.search.eligibleSellers}` : '-']),
  );
}

/** One row per field, one column per category: how each category may read it, and whether it may write it. */
export function formatPolicy(view: PolicyResult): string {
  const { policy } = view;
  const categories = Object.keys(policy.auto) as Array<keyof PolicyDocument['auto']>;
  const fields: string[] = [];
  for (const c of categories) {
    for (const f of [...policy.auto[c], ...Object.keys(policy.purpose[c]), ...policy.write[c]]) if (!fields.includes(f)) fields.push(f);
  }
  const cell = (c: (typeof categories)[number], f: string) => {
    const purposes = (policy.purpose[c] as Record<string, string[] | undefined>)[f];
    const read = (policy.auto[c] as string[]).includes(f) ? 'auto' : purposes ? `purpose:${purposes.join('|')}` : '-';
    return (policy.write[c] as string[]).includes(f) ? `${read} w` : read;
  };
  return `${sampleLabel(view.sample)}Policy ${clean(view.policyId)} · source ${clean(view.source)}\n`
    + table(['field', ...categories], fields.map(f => [f, ...categories.map(c => cell(c, f))]))
    + 'auto = read with the handshake · purpose:<p> = read only for that declared purpose · - = denied · w = writable\n'
    + (policy.ranking ? `ranking: winRate ${policy.ranking.winRate}, failure ${policy.ranking.failure}\n` : '');
}

export function formatShadow(report: ShadowResult): string {
  return `${sampleLabel(report.sample)}Candidate ${clean(report.candidateId)} vs current ${clean(report.currentId)}\n`
    + (report.changed.length
      ? report.changed.map(c => `${clean(c.ref)} ${c.kind} ${c.field} ${c.before} -> ${c.after}\n`).join('')
      : 'No decision changes.\n')
    + `unchanged: ${report.unchanged}\n`;
}

/** Consent links, newest first as the workspace lists them, with the command that decides a pending one. */
export function formatLinks(list: LinkList): string {
  const head = `${sampleLabel(list.sample)}Links · ${list.links.length} link${list.links.length === 1 ? '' : 's'}\n`;
  if (!list.links.length) return `${head}No links.\n`;
  return head + table(['id', 'agent', 'agent id', 'status', 'created', 'expires', 'decided'],
    list.links.map(l => [l.id, l.agentName, l.agentId, l.status, l.createdAt, l.expiresAt, l.decidedAt ?? '-']))
    + (list.links.some(l => l.status === 'pending') ? 'Decide a pending link: agent-cookie links approve <id> | links decline <id>\n' : '');
}

export function formatDecision(link: LinkResult): string {
  return `${sampleLabel(link.sample)}${link.status === 'approved' ? 'Approved' : 'Declined'} link ${clean(link.id)} · ${clean(link.agentName)} (${clean(link.agentId)})`
    + (link.sessionId ? ` · session ${clean(link.sessionId)}` : '') + '\n';
}

/** A link id as typed: printable, bounded, never a dot segment. Refused locally without echoing it. */
function linkId(id: string): string {
  if (!/^[\x21-\x7e]{1,256}$/.test(id) || /^[.]{1,2}$/.test(id)) throw new CliError('The link id is invalid.');
  return id;
}

/** A PolicyDocument, or the `policy show --json` output that wraps one. The workspace checks the floor. */
async function readPolicyFile(path: string): Promise<PolicyDocument> {
  let text: string;
  try {
    if ((await stat(path)).size > POLICY_FILE_MAX_BYTES) throw new CliError('The policy file is larger than 64 KB.');
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw error instanceof CliError ? error : new CliError('Unable to read the policy file.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new CliError('The policy file is not valid JSON.'); }
  if (isObject(parsed) && !Object.hasOwn(parsed, 'v') && isObject(parsed.policy)) parsed = parsed.policy;
  if (!isObject(parsed)) throw new CliError('The policy file must hold a JSON object.');
  return parsed as unknown as PolicyDocument;
}

export async function runCli(args: string[], env: NodeJS.ProcessEnv, io: CliIO,
  createClient = () => new WorkspaceClient(workspaceConfigFromEnv(env)), deps: CliDeps = {}): Promise<number> {
  const clientFor = deps.clientFor ?? ((baseUrl: string, key: string) => new WorkspaceClient({ baseUrl, key }));
  const healthy = deps.healthy ?? isHealthy;
  const readText = deps.readText ?? ((path: string) => readFile(path, 'utf8'));
  const start = deps.start ?? startWorkspace;
  const home = deps.homedir ?? homedir;
  let failure = 'Unable to read the card.';
  const program = new Command()
    .name('agent-cookie')
    .description('Local Agent Cookie CLI: first run (init), your card, keys for your own agents, the owner funnel, the field policy and consent links, through the workspace.')
    .option('--pretty', 'Format JSON for humans')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: () => {} });
  const json = (value: unknown) => io.out(`${JSON.stringify(value, null, program.opts().pretty ? 2 : undefined)}\n`);
  program.command('card').description('Read your own card and candidates; requires a personal key')
    .action(async () => {
      const client = createClient();
      if ((await client.getMe()).role !== 'personal') throw new WorkspaceError(403, 'SCOPE_DENIED');
      json(await client.getMyCard());
    });
  program.command('funnel').description('Per-intent funnel counts, never field values; requires the owner key')
    .option('--since <iso>', 'Only intents created at or after this ISO-8601 time')
    .option('--limit <n>', 'At most this many intents (1-1000)')
    .option('--json', 'Print the report as JSON')
    .action(async (opts: { since?: string; limit?: string; json?: boolean }) => {
      failure = 'Unable to read the funnel.';
      if (opts.since !== undefined && !Number.isFinite(Date.parse(opts.since))) throw new CliError('--since must be an ISO-8601 time.');
      if (opts.limit !== undefined && (!/^\d{1,4}$/.test(opts.limit) || Number(opts.limit) < 1 || Number(opts.limit) > 1000)) {
        throw new CliError('--limit must be an integer from 1 to 1000.');
      }
      const report = await createClient().getFunnel({
        ...(opts.since !== undefined ? { since: opts.since } : {}), ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}) });
      if (opts.json) json(report); else io.out(formatFunnel(report));
    });
  const policy = program.command('policy').description('Show, shadow or install the field-policy document');
  policy.action(() => { policy.outputHelp(); });
  policy.command('show').description('Show the installed document, its id and source; personal or owner key')
    .option('--json', 'Print the policy view as JSON')
    .action(async (opts: { json?: boolean }) => {
      failure = 'Unable to read the policy.';
      const view = await createClient().getPolicy();
      if (opts.json) json(view); else io.out(formatPolicy(view));
    });
  policy.command('shadow').description('Compare past decisions under a candidate document; nothing is installed; owner key')
    .argument('<file.json>', 'A policy document, or the output of policy show --json')
    .action(async (file: string) => {
      failure = 'Unable to shadow the policy.';
      const doc = await readPolicyFile(file);
      io.out(formatShadow(await createClient().shadowPolicy(doc)));
    });
  policy.command('set').description('Install a document; the workspace refuses one below the floor; owner key')
    .argument('<file.json>', 'A policy document, or the output of policy show --json')
    .action(async (file: string) => {
      failure = 'Unable to install the policy.';
      const doc = await readPolicyFile(file);
      const view = await createClient().setPolicy(doc);
      io.out(`${sampleLabel(view.sample)}Installed policy ${clean(view.policyId)} (source ${clean(view.source)})\n`);
    });
  const links = program.command('links').description('Consent links from company assistants: list, approve or decline; owner key');
  links.action(() => { links.outputHelp(); });
  links.command('list').description('Pending links to decide, and decided ones, newest first')
    .option('--json', 'Print the links as JSON')
    .action(async (opts: { json?: boolean }) => {
      failure = 'Unable to read the links.';
      const list = await createClient().listLinks();
      if (opts.json) json(list); else io.out(formatLinks(list));
    });
  links.command('approve').description('Approve one pending link: the assistant gets its pairwise session and grant')
    .argument('<id>', 'The link id, from links list')
    .action(async (id: string) => {
      failure = 'Unable to approve the link.';
      io.out(formatDecision(await createClient().approveLink(linkId(id))));
    });
  links.command('decline').description('Decline one pending link; the assistant may ask again later')
    .argument('<id>', 'The link id, from links list')
    .action(async (id: string) => {
      failure = 'Unable to decline the link.';
      io.out(formatDecision(await createClient().declineLink(linkId(id))));
    });
  program.command('init').description('First run of the personal path: find (or --start) a workspace, then mint a personal key for your own agent, shown once')
    .option('--url <url>', `The workspace (default: AGENT_COOKIE_URL, else ${DEFAULT_URL})`)
    .option('--start', 'Start a blank workspace from this repository, detached, if none answers at the URL')
    .option('--data-dir <dir>', 'Where the workspace keeps its data and owner.key (default: AGENT_COOKIE_DATA_DIR, else ~/.agent-cookie)')
    .option('--agent <id>', 'The agent id for your own agent', 'my-agent')
    .option('--label <text>', 'What the key is for, in your words', 'my own agent')
    .action(async (opts: { url?: string; start?: boolean; dataDir?: string; agent: string; label: string }) => {
      failure = 'Unable to initialise.';
      const baseUrl = baseOption(opts.url ?? env.AGENT_COOKIE_URL ?? DEFAULT_URL);
      const agentId = agentIdOption(opts.agent, '--agent');
      const label = labelOption(opts.label);
      const dataDir = resolve(opts.dataDir ?? env.AGENT_COOKIE_DATA_DIR ?? join(home(), '.agent-cookie'));
      if (await healthy(baseUrl)) {
        io.out(`A workspace answers at ${baseUrl}${opts.start ? '; not starting another' : ''}.\n`);
      } else if (opts.start) {
        failure = 'Unable to start the workspace.';
        const started = await start({ baseUrl, dataDir, env });
        io.out(`Started a blank workspace at ${baseUrl} (pid ${started.pid}). Data: ${dataDir}. Log: ${started.logPath}.\n`
          + `It keeps running in the background. Stop it with: kill ${started.pid}\n`);
      } else {
        throw new CliError(`No workspace answers at ${baseUrl}/healthz. Start one with: agent-cookie init --start (or pass --url).`);
      }
      // The owner key: never printed, never echoed in an error.
      let ownerKey = env.AGENT_COOKIE_OWNER_KEY?.trim();
      if (!ownerKey) {
        const path = join(dataDir, 'owner.key');
        try { ownerKey = (await readText(path)).trim(); }
        catch { throw new CliError(`No owner key: set AGENT_COOKIE_OWNER_KEY, or point --data-dir at the directory where the workspace wrote owner.key (looked in ${path}).`); }
      }
      if (!ownerKey || ownerKey.length > OWNER_KEY_MAX || /[^\x21-\x7e]/.test(ownerKey)) throw new CliError('The owner key is not a valid key.');
      failure = 'Unable to mint the key.';
      const minted = await clientFor(baseUrl, ownerKey).mintKey({ agentId, role: 'personal', label });
      io.out(`\n${formatMinted(minted, baseUrl)}\nThen, in your agent (Node 22, npm i @agent-cookie/sdk):\n\n${SNIPPET}\n`);
    });
  const keys = program.command('keys').description('Keys for your own agents and hand-added stores: mint, list or revoke; owner key');
  keys.action(() => { keys.outputHelp(); });
  keys.command('mint').description('Mint a key; it is printed once, to stdout, and never stored')
    .requiredOption('--agent <id>', 'The agent id, e.g. laptop (created when new)')
    .requiredOption('--role <role>', 'personal (reads the whole card) or merchant (a store you add by hand)')
    .requiredOption('--label <text>', 'What the key is for, in your words')
    .action(async (opts: { agent: string; role: string; label: string }) => {
      failure = 'Unable to mint the key.';
      const agentId = agentIdOption(opts.agent, '--agent');
      if (opts.role !== 'personal' && opts.role !== 'merchant') throw new CliError('--role must be personal or merchant.');
      const label = labelOption(opts.label);
      const baseUrl = baseOption(env.AGENT_COOKIE_URL ?? DEFAULT_URL);
      io.out(formatMinted(await createClient().mintKey({ agentId, role: opts.role, label }), baseUrl));
    });
  keys.command('list').description('The keys you minted, newest first: labels and dates, never a key')
    .option('--json', 'Print the keys as JSON')
    .action(async (opts: { json?: boolean }) => {
      failure = 'Unable to read the keys.';
      const list = await createClient().listKeys();
      if (opts.json) json(list); else io.out(formatKeys(list));
    });
  keys.command('revoke').description('Revoke every live key of one agent; it keeps what it already wrote')
    .argument('<agentId>', 'The agent id, from keys list')
    .action(async (id: string) => {
      failure = 'Unable to revoke the keys.';
      const result = await createClient().revokeKey(agentIdOption(id, 'The agent id'));
      io.out(`${sampleLabel(result.sample)}Revoked ${result.revoked} key${result.revoked === 1 ? '' : 's'} of ${clean(id)} at ${clean(result.revokedAt)}.\n`);
    });
  try {
    await program.parseAsync(args.length ? args : ['--help'], { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    if (error instanceof WorkspaceError && error.violations) {
      // The workspace names sections and field names only; one violation per line.
      io.err(`Policy rejected (${error.status} ${error.code}); nothing was changed:\n`);
      io.err(error.violations.length ? error.violations.map(v => `- ${clean(v)}\n`).join('') : '- The workspace did not name the violations.\n');
      return 1;
    }
    // Invalid arguments can include secrets: never echo Commander's raw error.
    const body = error instanceof WorkspaceError
      ? { status: error.status, code: error.code, message: error.message }
      : { message: error instanceof CommanderError ? 'Invalid command. Run agent-cookie --help.'
        : error instanceof CliError ? error.message
          : `${failure} Check local configuration and workspace availability.` };
    io.err(`${JSON.stringify({ error: body })}\n`);
    return 1;
  }
}
