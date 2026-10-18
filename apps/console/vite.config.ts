import { defineConfig, type Plugin } from 'vite';
import { createWorkspaceBridge, loadSdk } from './server/workspace.ts';

function workspace(): Plugin {
  const bridge = async (port: number) => createWorkspaceBridge({ key: () => process.env.AGENT_COOKIE_KEY,
    port, sample: process.env.AGENT_COOKIE_SAMPLE === '1',
    sdk: Promise.resolve(await loadSdk(process.env.AGENT_COOKIE_SDK_ROOT)) });
  return { name: 'agent-cookie-workspace',
    async configureServer(server) { server.middlewares.use(await bridge(server.config.server.port ?? 5173)); },
    async configurePreviewServer(server) { server.middlewares.use(await bridge(server.config.preview.port ?? 5173)); },
  };
}
export default defineConfig({
  plugins: [workspace()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
