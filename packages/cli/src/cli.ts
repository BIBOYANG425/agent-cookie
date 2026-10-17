import { Command, CommanderError } from 'commander';
import { WorkspaceClient, WorkspaceError, workspaceConfigFromEnv } from '@agent-cookie/sdk';

interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

export async function runCli(args: string[], env: NodeJS.ProcessEnv, io: CliIO,
  createClient = () => new WorkspaceClient(workspaceConfigFromEnv(env))): Promise<number> {
  const program = new Command()
    .name('agent-cookie')
    .description('Local Agent Cookie scaffold: read your personal card through the workspace.')
    .option('--pretty', 'Format JSON for humans')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: () => {} });
  program.command('card').description('Read your own card and candidates; requires a personal key')
    .action(async () => {
      const client = createClient();
      if ((await client.getMe()).role !== 'personal') throw new WorkspaceError(403, 'SCOPE_DENIED');
      io.out(`${JSON.stringify(await client.getMyCard(), null, program.opts().pretty ? 2 : undefined)}\n`);
    });
  try {
    await program.parseAsync(args.length ? args : ['--help'], { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    // Invalid arguments can include secrets: never echo Commander's raw error.
    const body = error instanceof WorkspaceError
      ? { status: error.status, code: error.code, message: error.message }
      : { message: error instanceof CommanderError ? 'Invalid command. Run agent-cookie --help.'
        : 'Unable to read the card. Check local configuration and workspace availability.' };
    io.err(`${JSON.stringify({ error: body })}\n`);
    return 1;
  }
}
