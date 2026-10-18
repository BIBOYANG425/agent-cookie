import { build } from 'esbuild';
// Contract publishes TypeScript with .js specifiers. Bundle its runtime constants
// into our JS distribution; consumers must not need a global TS loader.
await build({ entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,platform:'node',format:'esm',target:'node22',sourcemap:true });
