import { readConfig } from './config.js';
import { startStdio } from './server.js';
import { bindWorkspace } from './workspace.js';

async function main() {
  if (process.argv[2] === 'check') {
    let valid = false;
    try { readConfig(process.env); valid = true; } catch { /* Presence only. */ }
    console.log(JSON.stringify({ configValid: valid, sdkAvailable: true, workspaceVerified: false, networkCalled: false }));
    return;
  }
  if (process.argv.length > 2) throw new Error('Usage: agent-cookie-mcp [check]');
  const config = readConfig(process.env);
  const server = await startStdio(await bindWorkspace(config));
  const stop = () => { void server.close().finally(() => { process.exitCode = 0; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(() => {
  // Keep stdout exclusive to MCP frames and never print raw connection errors.
  console.error('Agent Cookie MCP is not ready. Check local configuration, a personal key and workspace availability in packages/mcp/README.md.');
  process.exitCode = 1;
});
