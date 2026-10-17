import { defineConfig } from 'vite';

// Fixed loopback target; no user-supplied origin and no key in build-time environment.
const proxy = {
  '/workspace-api': {
    target: 'http://127.0.0.1:4310',
    changeOrigin: false,
    followRedirects: false,
    rewrite: (path: string) => path.replace(/^\/workspace-api(?=\/|$)/u, ''),
  },
};
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
});
