# `@agent-cookie/auth`

Jar key storage, pairwise handshake and TAP signing, verification, and short-lived unlock-token helpers. Each merchant session gets a stable Ed25519 key derived from the encrypted jar master seed.

## Trusted Agent Protocol

`JarKeyStore.signTapRequest` signs the TAP `@authority` and `@path` components with the same per-session Ed25519 key used for handshakes. Its `keyId` is therefore the handshake `kid` for that session, and differs across sessions. The method returns the `Signature-Input` value and the RFC 9421 `Signature` header value; the defaults are a UUID nonce, the current Unix time, and a 480-second lifetime.

Use `tapRegistryKey(jar.publicJwk(sessionId))` to publish a session's registry entry. It returns the raw 32-byte Ed25519 public key in standard base64 with Visa's `ed25519` algorithm identifier. `verifyTapRequest` provides merchant-side verification with a 60-second future skew check and replay protection.

For an interoperability run against the local Visa reference services, start its agent registry, CDN proxy, merchant frontend (port 3000), and merchant backend, then run `pnpm --filter @agent-cookie/auth tap:interop`. The proxy forwards protected `/product/` requests to the frontend.

## Environment

- `AGENT_COOKIE_JAR_KEK`: base64url-encoded 32-byte key-encryption key for the jar file.
- `AGENT_COOKIE_UNLOCK_SECRET`: shared HMAC secret used for unlock handoff tokens.

## Run

Run the package tests with `pnpm --filter @agent-cookie/auth test` and typecheck with `pnpm --filter @agent-cookie/auth typecheck`.

## Honest limits

Passkeys gate time-boxed use of the jar key in memory; they do not derive the encryption key. The master seed is encrypted at rest under the local KEK. WebAuthn PRF integration and secure cross-device KEK recovery are future work.
