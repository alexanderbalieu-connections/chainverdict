import crypto from 'node:crypto';
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const b64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
console.log('SIGNING_KEY_PKCS8_B64=' + b64);
console.error('\nSave this in your password manager and set it as an env var in Render.');
console.error('Do NOT paste it into chat or screenshot it.');
