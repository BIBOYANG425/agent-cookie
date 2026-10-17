import { ChannelFailure } from './state.js';
import { configurationReport, readConfig } from './config.js';
import { ProbeFailure, runProbe } from './probe.js';
import { runLocalDemo } from './sample.js';

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const mode = args[0] ?? 'check';
  if (mode === 'check' && args.length <= 1) {
    console.log(JSON.stringify(configurationReport(process.env), null, 2));
  } else if (mode === 'demo' && args.length === 1) {
    console.log(JSON.stringify(await runLocalDemo(), null, 2));
  } else if (mode === 'smoke' && (args.length === 1 || (args.length === 2 && args[1] === '--send'))) {
    const config = readConfig(process.env);
    const { createPhotonPort } = await import('./photon.js');
    const sendReply = args[1] === '--send';
    console.log(sendReply
      ? 'Ready. Send a fresh ping from the configured test identity. One reply may be sent.'
      : 'Ready in receive-only mode. Send a fresh ping from the configured test identity. No reply will be sent.');
    const result = await runProbe(config, createPhotonPort(config), { sendReply });
    console.log(JSON.stringify(result));
    if (result.status === 'accepted') console.log('Photon accepted the request; confirm the reply on your device. Delivery is not confirmed by this process.');
    if (result.status === 'timeout') process.exitCode = 1;
  } else if (mode === 'serve' && args.length === 1) {
    const { serve } = await import('./runtime.js'); await serve(process.env);
  } else {
    throw new Error('Unknown command.');
  }
}

main().catch(error => {
  const code = (error instanceof ProbeFailure || error instanceof ChannelFailure) ? error.code : 'CONFIGURATION_OR_STARTUP_FAILED';
  console.error(JSON.stringify({ code, message: code === 'SEND_OUTCOME_UNKNOWN'
    ? 'Send outcome is unknown. Check Photon activity before retrying; retain the original message idempotency key.'
    : 'Check configuration, channel assignment and project permissions. Do not increase polling frequency after an API error.' }));
  process.exitCode = 1;
});
