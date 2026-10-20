/** Offline operator tool. The private key must never be mounted into the API. */
import { readFile, writeFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import { canonicalJson } from "../apps/api/src/canonical-json.js";
const [payloadPath, privateKeyPath, keyId, destination] = process.argv.slice(2);
if (!payloadPath || !privateKeyPath || !destination || !/^[a-zA-Z0-9_-]{1,80}$/.test(keyId ?? ""))
  throw new Error("Usage: tsx scripts/sign-geometry-control-source.ts payload.json private.pem keyId output.json");
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const key = createPrivateKey(await readFile(privateKeyPath));
if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required");
const envelope = { schemaVersion: "signed-geometry-control-source-v1", keyId, payload,
  signature: sign(null, Buffer.from(canonicalJson(payload)), key).toString("base64") };
await writeFile(destination, canonicalJson(envelope), { mode: 0o600, flag: "wx" });
