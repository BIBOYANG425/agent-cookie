# `@agent-cookie/auth`

Jar key storage, pairwise handshake signing and verification, and short-lived unlock-token helpers. Each merchant session gets a stable Ed25519 key derived from the encrypted jar master seed.

## Environment

- `AGENT_COOKIE_JAR_KEK`: base64url-encoded 32-byte key-encryption key for the jar file.
- `AGENT_COOKIE_UNLOCK_SECRET`: shared HMAC secret used for unlock handoff tokens.

## Run

Run the package tests with `pnpm --filter @agent-cookie/auth test` and typecheck with `pnpm --filter @agent-cookie/auth typecheck`.

## Honest limits

Passkeys gate time-boxed use of the jar key in memory; they do not derive the encryption key. The master seed is encrypted at rest under the local KEK. WebAuthn PRF integration and secure cross-device KEK recovery are future work.
