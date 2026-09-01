#!/usr/bin/env node
// mcp-keygen.mjs — Ed25519 keypair for MCP registry DNS authentication.
//
// The official guide says to use `openssl genpkey -algorithm Ed25519`. On macOS
// that fails with "Algorithm Ed25519 not found": Apple ships LibreSSL 3.3 as
// /usr/bin/openssl, and it has no Ed25519 support in genpkey. The failure is
// quiet in the worst way -- the follow-on command still prints
// "v=MCPv1; k=ed25519; p=" with an EMPTY public key, which looks like a valid
// DNS record and is not one.
//
// Node's crypto has Ed25519, so this does the same job with no Homebrew and no
// system OpenSSL. The byte arithmetic mirrors the guide exactly: the last 32
// bytes of the DER SPKI are the raw public key, and the last 32 bytes of the
// DER PKCS8 are the private seed.
//
// Usage:
//   node scripts/mcp-keygen.mjs         create key.pem (if absent), print the DNS TXT record
//   node scripts/mcp-keygen.mjs --hex   print ONLY the private key hex, for command substitution
//
// key.pem is gitignored. Never commit it, never paste it anywhere.
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const KEY = 'key.pem';
const hexOnly = process.argv.includes('--hex');

if (!existsSync(KEY)) {
  if (hexOnly) {
    console.error(`${KEY} does not exist. Run: node scripts/mcp-keygen.mjs`);
    process.exit(1);
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.error(`created ${KEY} (permissions 600, gitignored)\n`);
} else if (!hexOnly) {
  console.error(`${KEY} already exists — reusing it, not overwriting.`);
  console.error('If you have already published with a different key, delete key.pem and start over.\n');
}

const priv = createPrivateKey(readFileSync(KEY));
const seed = priv.export({ type: 'pkcs8', format: 'der' }).subarray(-32);

if (hexOnly) {
  process.stdout.write(seed.toString('hex'));
  process.exit(0);
}

const pub = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32);

console.log('Add this as a TXT record on chainverdict.xyz, name "@", content exactly:\n');
console.log(`v=MCPv1; k=ed25519; p=${pub.toString('base64')}`);
console.log('\nThe part after p= must NOT be empty. If it is, something is wrong -- stop.');
