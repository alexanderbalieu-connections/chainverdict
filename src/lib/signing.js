// Ed25519 response signing — tamper-evident, independently verifiable responses.
// Set SIGNING_KEY_PKCS8_B64 in env to pin a stable identity key; otherwise an
// ephemeral keypair is generated at boot (fine to start; pin one for production).
import { generateKeyPairSync, createPrivateKey, sign as edSign, createHash } from "node:crypto";

let privateKey, publicKeyB64;
const pinned = process.env.SIGNING_KEY_PKCS8_B64;
if (pinned) {
  privateKey = createPrivateKey({ key: Buffer.from(pinned, "base64"), format: "der", type: "pkcs8" });
  publicKeyB64 = Buffer.from(
    // derive SPKI public key
    (await import("node:crypto")).createPublicKey(privateKey).export({ format: "der", type: "spki" })
  ).toString("base64");
} else {
  const kp = generateKeyPairSync("ed25519");
  privateKey = kp.privateKey;
  publicKeyB64 = kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  console.log("signing: ephemeral Ed25519 key generated (set SIGNING_KEY_PKCS8_B64 to pin)");
}

// Canonical JSON: stable key ordering so verifiers reproduce the exact bytes.
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

export function signingInfo() {
  return {
    algorithm: "Ed25519",
    public_key_spki_b64: publicKeyB64,
    signed_payload: "Ed25519 over canonical JSON (keys sorted recursively, UTF-8)",
    headers: {
      "x-signature": "base64 Ed25519 signature of the response body in canonical form",
      "x-signature-key": "sha256 fingerprint of the SPKI public key",
      "x-signed-at": "ISO timestamp included in signature scope via x-signed-at binding: signature covers canonical(body) + '|' + timestamp"
    },
    verify_hint: "sig = Ed25519.verify(pubkey, canonical(body) + '|' + x-signed-at, x-signature)"
  };
}

const keyFingerprint = () => createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("hex").slice(0, 16);

// Express middleware: wraps res.json on matching paths to attach signature headers.
export function signResponses(pathPrefix = "/v1/") {
  const fp = keyFingerprint();
  return (req, res, next) => {
    if (!req.path.startsWith(pathPrefix)) return next();
    const orig = res.json.bind(res);
    res.json = (body) => {
      try {
        const ts = new Date().toISOString();
        const msg = Buffer.from(canonical(body) + "|" + ts, "utf8");
        const sig = edSign(null, msg, privateKey).toString("base64");
        res.set("x-signature", sig);
        res.set("x-signature-key", fp);
        res.set("x-signed-at", ts);
      } catch { /* never block a response on signing */ }
      return orig(body);
    };
    next();
  };
}
