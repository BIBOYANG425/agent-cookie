import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JarKeyStore } from "./jar-key-store.js";
import { tapRegistryKey } from "./tap.js";

const registryUrl = "http://localhost:9002";
const proxyUrl = "http://localhost:3001";
const registeredSession = `visa-tap-registered-${randomUUID()}`;
const unregisteredSession = `visa-tap-unregistered-${randomUUID()}`;
const authority = "localhost:3001";
const registeredPath = "/product/1?tap=valid";
const tamperSignedPath = "/product/1?tap=original";
const tamperRequestedPath = "/product/1?tap=changed";

async function requireStatus(
  response: Response,
  expected: number[] | ((status: number) => boolean),
  name: string,
): Promise<string> {
  const body = await response.text();
  console.log(`${name}: status=${response.status} body=${body.slice(0, 400).replace(/\s+/g, " ")}`);
  if (typeof expected === "function" ? !expected(response.status) : !expected.includes(response.status)) {
    throw new Error(`${name} returned unexpected status ${response.status}`);
  }
  return body;
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "agent-cookie-tap-interop-"));
  try {
    const jar = JarKeyStore.open({
      path: join(directory, "jar.json"),
      kek: Buffer.alloc(32, 23),
    });
    jar.unlock(5 * 60_000);

    const registeredJwk = jar.publicJwk(registeredSession);
    const registryKey = tapRegistryKey(registeredJwk);
    const registration = await fetch(`${registryUrl}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Agent Cookie TAP interoperability test",
        domain: "https://agent-cookie-tap.local",
        description: "Temporary Ed25519 key for local Visa TAP verification",
        keys: [{
          ...registryKey,
          description: "Throwaway TAP interop key",
          is_active: "true",
        }],
      }),
    });
    const registrationBody = await registration.text();
    console.log(`registry registration: status=${registration.status} body=${registrationBody.slice(0, 300).replace(/\s+/g, " ")}`);
    if (!registration.ok) throw new Error(`Registry registration returned ${registration.status}`);

    const registeredKeyResponse = await fetch(`${registryUrl}/keys/${registryKey.key_id}`);
    if (!registeredKeyResponse.ok) {
      throw new Error(`Registry lookup for registered key returned ${registeredKeyResponse.status}`);
    }
    const registeredKey = await registeredKeyResponse.json() as { key_id?: string; public_key?: string; algorithm?: string };
    if (
      registeredKey.key_id !== registryKey.key_id
      || registeredKey.public_key !== registryKey.public_key
      || registeredKey.algorithm?.toLowerCase() !== "ed25519"
    ) {
      throw new Error("Registry key lookup did not match the registered Ed25519 key");
    }

    const sign = async (sessionId: string, path: string) => jar.signTapRequest({
      sessionId,
      authority,
      path,
      tag: "agent-browser-auth",
    });
    const send = async (path: string, signed: Awaited<ReturnType<typeof sign>>) => fetch(`${proxyUrl}${path}`, {
      headers: {
        "Signature-Input": signed.signatureInput,
        Signature: signed.signature,
      },
    });

    const valid = await sign(registeredSession, registeredPath);
    await requireStatus(
      await send(registeredPath, valid),
      (status) => (status >= 200 && status < 300) || status === 502,
      "valid signature",
    );
    const replayBody = await requireStatus(await send(registeredPath, valid), [403], "replayed request");
    if (!/replay attack detected/i.test(replayBody)) {
      throw new Error("Replayed request did not return the proxy's replay response");
    }

    const tampered = await sign(registeredSession, tamperSignedPath);
    const tamperedBody = await requireStatus(
      await send(tamperRequestedPath, tampered),
      [403],
      "tampered path",
    );
    if (!/signature verification failed/i.test(tamperedBody)) {
      throw new Error("Tampered path did not return the proxy's bad-signature response");
    }

    const unregistered = await sign(unregisteredSession, "/product/1?tap=unregistered");
    const unregisteredBody = await requireStatus(
      await send("/product/1?tap=unregistered", unregistered),
      [403],
      "unregistered key",
    );
    if (!/key not found/i.test(unregisteredBody)) {
      throw new Error("Unregistered key request did not return the proxy's key-not-found response");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "TAP interop failed");
  process.exitCode = 1;
});
