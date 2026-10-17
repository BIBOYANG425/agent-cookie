import { defineConfig, type Plugin } from 'vite';
import { createWorkspaceBridge, loadSdk } from './server/workspace.ts';

function workspace(): Plugin {
  const bridge = async () => createWorkspaceBridge({ key: () => process.env.AGENT_COOKIE_KEY,
    sample: process.env.AGENT_COOKIE_SAMPLE === '1',
    sdk: Promise.resolve(await loadSdk(process.env.AGENT_COOKIE_SDK_ROOT)) });
  return { name: 'agent-cookie-workspace',
    async configureServer(server) { server.middlewares.use(await bridge()); },
    async configurePreviewServer(server) { server.middlewares.use(await bridge()); },
  };
}
export default defineConfig({
  plugins: [workspace()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
