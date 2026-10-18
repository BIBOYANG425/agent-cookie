// Generates PUBLIC Sample test keys only. No Visa account, certificate or credentials are involved.
import crypto from "node:crypto";
import forge from "node-forge";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.resolve("@agent-cookie/visa-sim"));
const MerchantConfig = require("cybersource-rest-client/src/authentication/core/MerchantConfig.js");
const jwt = require("cybersource-rest-client/src/authentication/jwt/JWTSigToken.js");
const merchantId = "visa-sim-sample";
const password = "SampleOnlyNotAVisaCredential";
const kid = "SampleJwtSubjectSerial";
const pair = forge.pki.rsa.generateKeyPair(2048);
const certificate = forge.pki.createCertificate();
certificate.publicKey = pair.publicKey;
certificate.serialNumber = "01";
certificate.validity.notBefore = new Date("2020-01-01T00:00:00Z");
certificate.validity.notAfter = new Date("2040-01-01T00:00:00Z");
const subject = [{ name: "commonName", value: merchantId }, { name: "serialNumber", value: kid }];
certificate.setSubject(subject);
certificate.setIssuer(subject);
certificate.sign(pair.privateKey, forge.md.sha256.create());
const p12 = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(pair.privateKey, certificate, password,
  { algorithm: "3des", friendlyName: `CN=${merchantId}` })).getBytes(), "binary");
const sample = {
  _provenance: "PUBLIC Sample test private key and self-signed certificate, generated locally. Not Visa credentials. Never use outside tests/simulator.",
  merchantId, p12Password: password, p12Base64: p12.toString("base64"), certificatePem: forge.pki.certificateToPem(certificate),
};
writeFileSync(new URL("../../../apps/visa-sim/scenarios/jwt-sample.json", import.meta.url), JSON.stringify(sample, null, 2) + "\n");
const directory = mkdtempSync(join(tmpdir(), "Sample-visa-jwt-"));
const originalTime = Date.now;
const originalUuid = crypto.randomUUID;
const date = "2026-10-18T12:00:00.000Z";
const jti = "00000000-0000-4000-8000-000000000001";
const host = "apitest.cybersource.com";
const logger = { info() {}, error() {}, debug() {}, warn() {} };
try {
  writeFileSync(join(directory, "sample.p12"), p12);
  Date.now = () => Date.parse(date);
  crypto.randomUUID = () => jti;
  const cases = [
    { name: "authorization", path: "/pts/v2/payments", body: '{"processingInformation":{"capture":false},"Sample":"authorization"}' },
    { name: "capture", path: "/pts/v2/payments/sim00000001/captures", body: '{"Sample":"capture"}' },
    { name: "reversal", path: "/pts/v2/payments/sim00000001/reversals", body: '{"Sample":"reversal"}' },
  ].map((input) => {
    const mc = new MerchantConfig({ authenticationType: "jwt", jwtKeyType: "P12", merchantID: merchantId,
      keysDirectory: directory, keyFileName: "sample", keyAlias: merchantId, keyPass: password,
      runEnvironment: host, logConfiguration: { enableLog: false } });
    mc.setRequestHost(host); mc.setRequestType("POST"); mc.setRequestTarget(input.path); mc.setRequestJsonData(input.body);
    return { ...input, sdkOutput: jwt.getToken(mc, false, logger) as string };
  });
  writeFileSync(new URL("../test/fixtures/visa-acceptance/sdk-jwt-golden.json", import.meta.url), JSON.stringify({
    _provenance: "Generated offline by official cybersource-rest-client@0.0.84 JWTSigToken.js, PUBLIC Sample P12; not Visa server acceptance.",
    sdk: { package: "cybersource-rest-client", version: "0.0.84" }, date, jti, host, cases,
  }, null, 2) + "\n");
} finally {
  Date.now = originalTime;
  crypto.randomUUID = originalUuid;
  rmSync(directory, { recursive: true, force: true });
}
