import { build } from 'esbuild';
// Keep third-party packages external; embed the TS-only contract's runtime values.
await build({ entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,platform:'node',format:'esm',target:'node22',external:['zod','@photon-ai/otel'],sourcemap:true });
