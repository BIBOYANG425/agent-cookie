import { readFile, stat } from 'node:fs/promises';
import { Command, CommanderError } from 'commander';
import {
  WorkspaceClient, WorkspaceError, workspaceConfigFromEnv,
  type FunnelReport, type LinkList, type LinkResult, type PolicyDocument, type PolicyResult, type ShadowResult,
} from '@agent-cookie/sdk';

interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

/** A local failure whose message is already safe to print: never a key, a file's contents or a raw upstream message. */
class CliError extends Error {}

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
  createClient = () => new WorkspaceClient(workspaceConfigFromEnv(env))): Promise<number> {
  let failure = 'Unable to read the card.';
  const program = new Command()
    .name('agent-cookie')
    .description('Local Agent Cookie CLI: your card, the owner funnel, the field policy and consent links, through the workspace.')
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
