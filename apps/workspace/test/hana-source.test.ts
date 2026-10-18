import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/db.js';
import {harness, KEYS, callbackServer} from './harness.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
describe('HANA conversation provenance', () => {
  it('keeps the opaque conversation after reopening SQLite, without changing legacy rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hana-conversation-db-'));
    cleanup.push(() => rmSync(dir, {recursive:true, force:true}));
    const file=join(dir,'workspace.sqlite');let store=new Store(file);
    const base={userId:'u',agentId:'hana',public:{},createdAt:new Date().toISOString(),expiresAt:new Date().toISOString()};
    store.insertIntent({...base,id:'legacy'});
    store.close();
    // Exercise migration of an existing v13 database, not only a fresh schema.
    store=new Store(file);store.db.exec('ALTER TABLE intents DROP COLUMN conversation_id; PRAGMA user_version=13');store.close();
    store=new Store(file);store.insertIntent({...base,id:'current',conversationId:'1234567890abcdef'});store.close();
    store=new Store(file);cleanup.push(()=>store.close());
    expect(store.intent('legacy')?.conversationId).toBeUndefined();
    expect(store.intent('current')?.conversationId).toBe('1234567890abcdef');
  });
  it('validates provenance before writing an intent and requires owner authorization for personal registration',async()=>{
    const h=await harness();cleanup.push(()=>h.deps.close());
    for(const conversationId of ['', 'a'.repeat(129), 'bad / id', '+12135550100', 'user@example.com']){
      const r=await h.post('/personal/intents',KEYS.personal,{text:'shoes',conversationId});
      expect(r.status).toBe(422);
    }
    expect(h.deps.store.db.prepare('SELECT COUNT(*) AS n FROM intents').get()).toEqual({n:0});
    expect((await h.post('/agents/register',KEYS.personal,{name:'HANA test',category:'personal'})).status).toBe(403);
    const r=await h.post('/agents/register',KEYS.owner,{name:'HANA test',category:'personal',capabilities:[]});
    expect(r.status).toBe(201);expect(r.body.role).toBe('personal');
    expect((await h.get('/me',r.body.key)).body).toMatchObject({agentId:r.body.agentId,role:'personal'});
  });
  it('keeps conversation identity out of the merchant introduction',async()=>{
    const cb=await callbackServer();cleanup.push(()=>cb.close());
    const h=await harness();cleanup.push(()=>h.deps.close());
    const reg=await h.post('/agents/register',undefined,{name:'Sample callback',category:'retail',capabilities:['hana_test'],callbackUrl:cb.url});
    expect(reg.status).toBe(201);
    const r=await h.post('/personal/intents',KEYS.personal,{text:'shoes',kind:'hana_test',conversationId:'abcdef0123456789'});
    expect(r.status).toBe(201);await vi.waitFor(()=>expect(cb.bodies.length).toBeGreaterThan(0));
    expect(h.deps.store.intent(r.body.intentId)?.conversationId).toBe('abcdef0123456789');
    expect(JSON.stringify(cb.bodies)).not.toContain('abcdef0123456789');
    expect(JSON.stringify(cb.bodies)).not.toContain('conversationId');
  });
});
