# Visa TAP interoperability evidence

**Visa reference repository:** `trusted-agent-protocol` at `16d59bdf3f8a542bc538d0962edbb80ea30a02af`  
**Runtime:** Node `v22.23.3`, pnpm `9.12.0`  
**Registry algorithm:** `ed25519` (registry stores the raw 32-byte public key as standard base64)

The test registered a throwaway Ed25519 key, signed requests with `authority=localhost:3001`, and sent them through the Visa CDN proxy. The authority matched the proxy's `Host` header. Four requests produced:

| Case | HTTP status | Proxy result |
| --- | ---: | --- |
| Valid signature | 200 | Ed25519 verification succeeded; forwarded to the Visa merchant frontend |
| Same signed request replayed | 403 | Replay detected |
| Signed path changed before sending | 403 | Ed25519 signature verification failed |
| Key not registered | 403 | Key not found |

Relevant proxy output from that run:

```text
🎯 Ed25519 Verification result: VALID ✅
✅ CDN: RFC 9421 signature verification successful!
[HPM] GET /product/1?tap=valid -> http://localhost:3000
❌ CDN: Replay attack detected - nonce already used
🎯 Ed25519 Verification result: INVALID ❌
❌ CDN: ed25519 signature verification failed
❌ CDN: Key not found - blocking
```

The interop script also printed the corresponding response statuses: `valid signature: status=200`, `replayed request: status=403`, `tampered path: status=403`, and `unregistered key: status=403`.

## Commands and services

Commands were run from the named Visa repository directories; the Agent Cookie command was run from the `agent-cookie-tap` worktree.

```sh
# agent-registry/
../.venv/bin/python main.py

# merchant-backend/
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# cdn-proxy/
npx -y -p node@22 -p pnpm@9.12.0 -c 'node --version && PORT=3001 npm start'

# merchant-frontend/ (its dependencies were installed with --no-package-lock)
npx -y -p node@22 -p pnpm@9.12.0 -c 'node --version && npm install --no-package-lock'
npx -y -p node@22 -p pnpm@9.12.0 -c 'node --version && npm run dev -- --host 127.0.0.1'

# agent-cookie-tap/
pnpm --filter @agent-cookie/auth tap:interop
```

The interop command registers an ephemeral key at `POST http://localhost:9002/agents/register`, then performs all four requests through `http://localhost:3001`. The local Visa services were left running:

| Service | Port |
| --- | ---: |
| Agent registry | 9002 |
| CDN proxy | 3001 |
| Merchant backend | 8000 |
| Merchant frontend | 3000 |

The frontend was also started because the proxy forwards `/product/` requests to `localhost:3000`; the backend on port 8000 serves `/api` and is not the destination of the signed path. An initial attempt without the frontend logged `ECONNREFUSED` for port 3000 and did not return an HTTP status. With Visa's sample frontend running, the valid signed request returned 200.

## Verifier behavior observed

- The proxy accepts lowercase `ed25519`, fetches the key from the registry, uses the request `Host` as authority, and includes the path and query in `@path`. Its base string joins the authority, path, and signature-params lines with `\n`, matching the implemented wire format.
- Its timestamp checks use the described 60-second future skew and reject past expiration.
- The proxy records a nonce **before** verifying the cryptographic signature, so an invalid signature can consume a nonce. The local verifier intentionally records it only after successful verification.
- `tag` is logged but is not checked against an expected value by the proxy; the local verifier provides an optional `expectedTag` check.
- Only paths beginning `/product/` are protected by the signature middleware. The proxy forwards those requests to the frontend on port 3000; `/api` is forwarded to the backend on port 8000.
- The proxy's startup banner lists only RSA-PSS, but its code and the successful request logs confirm that Ed25519 is supported. Its parser is more permissive about signature components; the local parser requires the specified `@authority`/`@path` pair and required TAP attributes, while accepting Visa's attribute-order variations.
