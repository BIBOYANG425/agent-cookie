# `@agent-cookie/unlock`

Local Hono passkey page for registering the jar owner's credential and unlocking the jar. Start with `pnpm --filter @agent-cookie/unlock start`; the service binds to `127.0.0.1` on port `4312` by default.

## Environment

- `PORT` (default `4312`), `UNLOCK_RP_ID` (default `localhost`), `UNLOCK_ORIGIN` (default `http://localhost:4312`)
- `UNLOCK_TTL_MS` (default `900000`), `UNLOCK_DATA_DIR` (default `apps/unlock/.data`)
- `UNLOCK_ALLOW_REGISTER` (`1` permits additional registrations)
- `UNLOCK_DEV` (`1` enables the standalone `/dev/sign` demo route)
- `AGENT_COOKIE_URL`, `AGENT_COOKIE_KEY`, and `AGENT_COOKIE_UNLOCK_SECRET` for workspace handoff
- `AGENT_COOKIE_JAR_KEK`: optional base64url-encoded 32-byte key for standalone mode; otherwise a local KEK is generated in the data directory

## Run

Run tests with `pnpm --filter @agent-cookie/unlock test` and typecheck with `pnpm --filter @agent-cookie/unlock typecheck`. Expose the loopback service to a phone only through a trusted HTTPS tunnel.

## Honest limits

The passkey gates a time-boxed in-memory unlock; the jar seed is encrypted at rest under a local KEK, not a passkey-derived key. WebAuthn PRF and production-grade device/key recovery are future work. The initial registration is open while no credential exists, so protect the tunnel during first-time setup.
