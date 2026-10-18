import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

// A's queue lifecycle is an integration dependency, outside the default unit glob.
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  test:{include:['test/learning-workspace.acceptance.ts'],fileParallelism:false},
});
