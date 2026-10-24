// Ed25519 response signing. Every paid answer is signed so a buyer can verify
// offline that the result came from this service and was not tampered with —
// the same provable-answer property ChainVerdict and x402pulse use.

import crypto from 'node:crypto';

export class Signer {
  constructor(pkcs8Base64) {
    if (pkcs8Base64) {
      this.privateKey = crypto.createPrivateKey({
        key: Buffer.from(pkcs8Base64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } else {
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      this.privateKey = privateKey;
      this.ephemeral = true;
    }
    this.publicKey = crypto.createPublicKey(this.privateKey);
    this.jwk = this.publicKey.export({ format: 'jwk' });
    this.keyId = crypto.createHash('sha256')
      .update(Buffer.from(this.jwk.x, 'base64url'))
      .digest('hex')
      .slice(0, 16);
  }

  // Compact JWS (EdDSA) over a JSON payload.
  sign(payload) {
    const header = { alg: 'EdDSA', typ: 'JWT', kid: this.keyId };
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signingInput = `${enc(header)}.${enc(payload)}`;
    const sig = crypto.sign(null, Buffer.from(signingInput), this.privateKey);
    return `${signingInput}.${sig.toString('base64url')}`;
  }

  wellKnown() {
    return {
      service: 'traderails',
      alg: 'EdDSA',
      keys: [{ ...this.jwk, kid: this.keyId, use: 'sig' }],
      note: 'Verify any signed TradeRails response against this key. EdDSA (Ed25519) compact JWS.',
    };
  }
}
