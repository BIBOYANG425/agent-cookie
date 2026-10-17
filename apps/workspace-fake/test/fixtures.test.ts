import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixtures } from '../src/fixtures.js';
import { writeSampleFixtures } from '../src/sample-seed.js';

it('loads contract dev-key maps and joins roles with the one-user seed without printing keys',async()=>{
 const path=await mkdtemp(join(tmpdir(),'cookie-seed-'));
 try {await writeSampleFixtures(path);const fixtures=await loadFixtures(path);
  expect(fixtures.users).toHaveLength(1);expect(fixtures.keys.map(k=>k.role)).toEqual(['personal','owner','merchant','merchant']);
  expect(fixtures.keys.every(k=>k.userId===fixtures.users[0].userId)).toBe(true);expect(fixtures.quotes).toHaveLength(2);
 }finally{await rm(path,{recursive:true,force:true});}
});
