import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, type ErrorCode } from '@agent-cookie/contract';
import { AssistantClient, MerchantClient, WORKSPACE_ERROR_CODES, WorkspaceClient, WorkspaceError, isWorkspaceError } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-secret-key' };
const codes = Object.entries(ERROR_STATUS) as Array<[ErrorCode, number]>;

describe('typed errors for every contract code', () => {
  it('knows exactly the contract\'s error codes', () => {
    expect([...WORKSPACE_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_STATUS).sort());
  });

  it.each(codes)('%s (%i) reaches every client as a WorkspaceError with its code and a fixed message', async (code, status) => {
    const fetch = async () => Response.json({ error: { code, message: `field shipping_address value 1 Main St ${config.key}` } }, { status });
    const calls = [
      () => new WorkspaceClient({ ...config, fetch }).getMe(),
      () => new AssistantClient({ ...config, fetch }).context(),
      () => new MerchantClient({ ...config, fetch }).handshake('sess_store'),
    ];
    const messages = new Set<string>();
    for (const call of calls) {
      const error = await call().catch(e => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ name: 'WorkspaceError', code, status });
      expect(isWorkspaceError(error)).toBe(true);
      expect(isWorkspaceError(error, code)).toBe(true);
      expect(String(error) + JSON.stringify(error)).not.toMatch(/shipping_address|Main St|sample-secret-key/);
      messages.add(error.message);
    }
    expect(messages.size).toBe(1);
    expect([...messages][0]).not.toBe('The workspace request failed.');
  });

  it('gives each code its own message', () => {
    const messages = WORKSPACE_ERROR_CODES.map(code => new WorkspaceError(ERROR_STATUS[code], code).message);
    expect(new Set(messages).size).toBe(WORKSPACE_ERROR_CODES.length);
  });

  it('isWorkspaceError narrows by code and rejects anything else', () => {
    const error = new WorkspaceError(403, 'PURPOSE_MISMATCH');
    expect(isWorkspaceError(error, 'SCOPE_DENIED', 'PURPOSE_MISMATCH')).toBe(true);
    expect(isWorkspaceError(error, 'SCOPE_DENIED')).toBe(false);
    expect(isWorkspaceError(new Error('PURPOSE_MISMATCH'))).toBe(false);
    expect(isWorkspaceError({ code: 'PURPOSE_MISMATCH', status: 403 })).toBe(false);
  });

  it('keeps an unknown code opaque instead of inventing one', async () => {
    const fetch = async () => Response.json({ error: { code: 'CONFLICT', message: 'private' } }, { status: 409 });
    const error = await new AssistantClient({ ...config, fetch }).requestLink().catch(e => e);
    expect(error).not.toBeInstanceOf(WorkspaceError);
    expect(String(error)).not.toMatch(/CONFLICT|private/);
  });
});
