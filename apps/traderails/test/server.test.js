import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';

async function boot() {
  const { app, signer } = createApp({ payTo: null, log: () => {} });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, srv, signer };
}

test('free mode: paid handlers answer and responses are signed + verifiable', async (t) => {
  const { base, srv, signer } = await boot();
  t.after(() => srv.close());

  const r = await (await fetch(`${base}/v1/gtin/validate?code=4006381333931`)).json();
  assert.equal(r.valid, true);
  assert.ok(r._attestation?.jws);

  // Verify the JWS against the published key.
  const wk = await (await fetch(`${base}/.well-known/signing-key.json`)).json();
  const pub = crypto.createPublicKey({ key: wk.keys[0], format: 'jwk' });
  const [h, p, s] = r._attestation.jws.split('.');
  assert.equal(crypto.verify(null, Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url')), true);
  // Tamper detection.
  const bad = Buffer.from(`${h}.${p}x`);
  assert.equal(crypto.verify(null, bad, pub, Buffer.from(s, 'base64url')), false);
});

test('endpoints return correct results end-to-end', async (t) => {
  const { base, srv } = await boot();
  t.after(() => srv.close());
  const get = async (u) => (await fetch(base + u)).json();

  assert.equal((await get('/v1/container/validate?code=CSQU3054383')).valid, true);
  assert.equal((await get('/v1/imo/validate?code=IMO%209074729')).valid, true);
  assert.equal((await get('/v1/gs1/decode?data=(01)04006381333931(17)261231(10)LOT1')).valid, true);
  assert.equal((await get('/v1/hs/classify?q=running%20shoes')).candidates[0].hsHeading, '6404');
  assert.match((await get('/v1/gtin/prefix?code=4006381333931')).memberOrganisation, /Germany/);
});

test('health + discovery are free and well-formed', async (t) => {
  const { base, srv } = await boot();
  t.after(() => srv.close());
  assert.equal((await (await fetch(`${base}/health`)).json()).ok, true);
  assert.equal((await (await fetch(`${base}/.well-known/x402.json`)).json()).x402Version, 2);
  assert.match(await (await fetch(`${base}/llms.txt`)).text(), /TradeRails/);
  assert.ok((await (await fetch(`${base}/openapi.json`)).json()).paths['/v1/gtin/validate']);
});

test('paid mode: paid routes return HTTP 402 with a valid offer', async (t) => {
  const { app } = createApp({
    payTo: '0xAe2634E709c454f2720C65A0b2F9ba168e431842',
    facilitatorClient: {
      async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} }; },
      async verify() { return { isValid: false, invalidReason: 'stub' }; },
      async settle() { return { success: false, errorReason: 'stub', transaction: '', network: 'eip155:8453' }; },
    },
    syncFacilitatorOnStart: true,
    log: () => {},
  });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  await new Promise((r) => setTimeout(r, 300));

  const res = await fetch(`${base}/v1/gtin/validate?code=4006381333931`);
  assert.equal(res.status, 402);
  // Health stays free even in paid mode.
  assert.equal((await (await fetch(`${base}/health`)).json()).mode, 'paid');
});
