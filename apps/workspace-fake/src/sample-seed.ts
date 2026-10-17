import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Fixtures } from './fixtures.js';

/** Explicit B-owned fallback for tests while C's fixtures are not published. */
export function sampleFixtures(now = '2026-10-17T19:00:00.000Z'): Fixtures {
  const agents = [
    { agentId: 'sample-personal', name: 'Sample Personal', category: 'personal' as const, capabilities: [], createdAt: now },
    { agentId: 'sample-shoe-a', name: 'Sample Shoe A', category: 'shoe' as const, capabilities: ['trail_shoes'], domain: 'a.example.com', createdAt: now },
    { agentId: 'sample-shoe-b', name: 'Sample Shoe B', category: 'shoe' as const, capabilities: ['trail_shoes'], domain: 'b.example.com', createdAt: now },
  ];
  return {
    users: [{userId:'sample-user',name:'Sample User',secret:'Sample-only-pairwise-secret'}], agents,
    keys: [
      {key:'sample-personal-key',userId:'sample-user',agentId:'sample-personal',role:'personal',category:'personal'},
      {key:'sample-owner-key',userId:'sample-user',agentId:'owner',role:'owner',category:'personal'},
      {key:'sample-shoe-a-key',userId:'sample-user',agentId:'sample-shoe-a',role:'merchant',category:'shoe'},
      {key:'sample-shoe-b-key',userId:'sample-user',agentId:'sample-shoe-b',role:'merchant',category:'shoe'},
    ],
    contributions: [
      ['lang','zh'], ['tone','简短'], ['length','short'], ['shoe_size','42'], ['budget','120'],
      ['shipping_address','Sample address — 123 Example St, Los Angeles, CA 90001'],
    ].map(([field,value],i)=>({id:`sample-contribution-${i}`,userId:'sample-user',agentId:'sample-personal',field:field as Fixtures['contributions'][number]['field'],value,basis:'stated',createdAt:now})),
    quotes: [
      {agentId:'sample-shoe-a',text:'Sample 越野跑鞋 A',title:'Sample Trail A',price:9900,currency:'USD',etaDate:null,seller:'a.example.com',variantId:'sample-variant-a',checkoutUrl:'https://a.example.com/sample-checkout'},
      {agentId:'sample-shoe-b',text:'Sample 越野跑鞋 B',title:'Sample Trail B',price:11500,currency:'USD',etaDate:null,seller:'b.example.com',variantId:'sample-variant-b',checkoutUrl:'https://b.example.com/sample-checkout'},
    ],
  };
}

export async function writeSampleFixtures(directory: string) {
  const fixtures = sampleFixtures(new Date().toISOString()); await mkdir(directory,{recursive:true,mode:0o700});
  for (const [name,value] of Object.entries({users:fixtures.users,agents:fixtures.agents,'dev-keys':Object.fromEntries(fixtures.keys.map(k=>[k.key,{agentId:k.agentId,role:k.role}])),contributions:fixtures.contributions,quotes:fixtures.quotes})) {
    await writeFile(join(directory,`${name}.json`),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  }
}

if (process.argv.includes('--write')) {
  await writeSampleFixtures(resolve('.runtime/sample-fixtures'));
  console.log('B-local Sample fixtures created. These are not C-lane fixtures and contain no real user data.');
}
