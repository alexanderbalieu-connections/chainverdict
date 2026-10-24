import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { settlementEvidence } from '../lib/settlement-evidence.js';
const tx = '0x' + 'a'.repeat(64);
const result = { success: true, transaction: tx, network: 'eip155:8453', payer: 'PRIVATE-PAYER' };
function fixture(log = () => {}) {
  const p = settlementEvidence({ service: 'test', routeKeys: ['GET /paid/*', 'POST /mcp'], log });
  let settle; p.attach({ onAfterSettle(fn) { settle = fn; } });
  return { p, settle };
}
async function request(p, next, path = '/paid/PRIVATE-INPUT', method = 'GET') {
  const res = new EventEmitter(); res.statusCode = 200; res.headersSent = true;
  await p.middleware({ path, method, headers: { 'payment-signature': 'SECRET' } }, res, () => next(res));
}
test('successful settlement is linked to a fixed route only after response completion', async () => {
  const logs = []; const { p, settle } = fixture(s => logs.push(JSON.parse(s)));
  await request(p, async res => {
    await settle({ result }); assert.equal(logs.length, 0);
    res.emit('finish'); res.emit('close');
  });
  assert.equal(logs.length, 1); assert.equal(logs[0].route, 'GET /paid/*');
  assert.equal(logs[0].transaction, tx); assert.equal(logs[0].outcome, 'settled_response_finished');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|SECRET|payer|headers/);
});
test('unpaid, failed, uncorrelated and malformed settlements do not manufacture purchases', async () => {
  const logs = []; const { p, settle } = fixture(s => logs.push(s));
  await settle({ result });
  assert.equal(JSON.parse(logs.pop()).outcome, 'uncorrelated_settlement');
  for (const r of [{ ...result, success: false }, { ...result, transaction: 'untrusted' }, { ...result, network: 'evil' }]) {
    await request(p, async res => { await settle({ result: r }); res.emit('finish'); });
  }
  await request(p, res => res.emit('finish'));
  await request(p, res => res.emit('finish'), '/free');
  assert.equal(logs.length, 0);
});
test('late hook, abort and server errors are recorded without claiming successful delivery', async () => {
  const logs = []; const { p, settle } = fixture(s => logs.push(JSON.parse(s)));
  await request(p, async res => { res.emit('finish'); await settle({ result }); }, '/mcp', 'POST');
  await request(p, async res => { await settle({ result }); res.emit('close'); });
  await request(p, async res => { res.statusCode = 500; await settle({ result }); res.emit('finish'); });
  assert.equal(logs[0].route, 'POST /mcp');
  assert.equal(logs[1].outcome, 'settled_response_failed_or_aborted');
  assert.equal(logs[2].outcome, 'settled_response_failed_or_aborted');
});
test('concurrent requests retain their own context; logging failure cannot break service', async () => {
  const logs = []; const { p, settle } = fixture(s => logs.push(JSON.parse(s)));
  await Promise.all(Array.from({ length: 8 }, (_, i) => request(p, async res => {
    await new Promise(r => setTimeout(r, i));
    await settle({ result: { ...result, transaction: '0x' + String(i).repeat(64) } }); res.emit('finish');
  })));
  assert.equal(new Set(logs.map(r => r.transaction)).size, 8);
  const bad = fixture(() => { throw new Error('disk/log failure'); });
  await request(bad.p, async res => { await bad.settle({ result }); res.emit('finish'); });
});

test('real Express payment middleware and SDK preserve request correlation', async t => {
  const { default: express } = await import('express');
  const { paymentMiddleware, x402ResourceServer } = await import('@x402/express');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');
  const logs = []; let valid = false;
  const p = settlementEvidence({ service: 'sdk-test', routeKeys: ['GET /paid/*'], log: s => logs.push(JSON.parse(s)) });
  const resource = new x402ResourceServer({
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} }; },
    async verify() { return { isValid: valid, payer: '0x9999999999999999999999999999999999999999' }; },
    async settle() { return result; },
  }).register('eip155:8453', new ExactEvmScheme());
  p.attach(resource);
  const app = express(); app.use(p.middleware);
  app.use(paymentMiddleware({ 'GET /paid/*': { accepts: { scheme: 'exact', price: '$0.001', network: 'eip155:8453', payTo: '0x1234567890123456789012345678901234567890' } } }, resource));
  app.get('/paid/:id', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => server.close()); const url = `http://127.0.0.1:${server.address().port}/paid/PRIVATE-INPUT`;
  const challenge = await fetch(url); assert.equal(challenge.status, 402);
  const offer = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString());
  const payment = { x402Version: 2, resource: offer.resource, accepted: offer.accepts[0], payload: { signature: 'synthetic', authorization: { from: '0x9999999999999999999999999999999999999999' } } };
  const headers = { 'payment-signature': Buffer.from(JSON.stringify(payment)).toString('base64') };
  assert.equal((await fetch(url, { headers })).status, 402); assert.equal(logs.length, 0);
  valid = true; const response = await fetch(url, { headers }); assert.equal(response.status, 200); await response.text();
  assert.equal(logs.length, 1); assert.equal(logs[0].transaction, tx);
  assert.equal(logs[0].route, 'GET /paid/*'); assert.equal(logs[0].outcome, 'settled_response_finished');
});

test('bare wildcard prefix and overlapping keys match the SDK and prefer specificity', async () => {
  const { paidRouteMatchers } = await import('../lib/paid-route-matchers.js');
  const routes = paidRouteMatchers(['GET /paid/*', 'GET /paid/exact']);
  assert.equal(routes.find(r => r.pattern.test('/paid/exact')).key, 'GET /paid/exact');
  for (const path of ['/paid', '/paid/', '/PAID/value/']) assert.ok(routes.some(r => r.pattern.test(path)));
});
test('abort before response headers does not invent HTTP 200', async () => {
  const logs=[]; const {p,settle}=fixture(s=>logs.push(JSON.parse(s)));
  await request(p, async res => { res.headersSent=false; await settle({result}); res.emit('close'); });
  assert.equal(logs[0].httpStatus,null); assert.equal(logs[0].responseFinished,false);
});
