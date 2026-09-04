// The 402 body must carry the challenge, not "{}".
//
// Wired through a real Express app and a real HTTP request, because the thing
// under test is a res.json override and an override that is installed in the
// wrong order, or bypassed by the library's own response buffering, passes
// every unit test and still ships two bytes. The x402 middleware itself is not
// in the loop here: it needs a live facilitator to produce a 402 at all, so the
// route below does what the library does on the unpaid path -- set the header,
// then res.status(402).json({}) -- and the assertion is on what the wire shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mirror402Body } from '../src/lib/mirror-402.js';

const CHALLENGE = {
  x402Version: 2,
  error: 'Payment required',
  accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '1000', payTo: '0x0000000000000000000000000000000000000001' }],
};
const encoded = Buffer.from(JSON.stringify(CHALLENGE)).toString('base64');

function serve() {
  const app = express();
  app.use(mirror402Body());
  app.get('/unpaid', (req, res) => { res.setHeader('payment-required', encoded); res.status(402).json({}); });
  app.get('/no-header', (req, res) => { res.status(402).json({}); });
  app.get('/bad-header', (req, res) => { res.setHeader('payment-required', '%%%not-base64-json%%%'); res.status(402).json({}); });
  app.get('/paywall', (req, res) => { res.setHeader('payment-required', encoded); res.status(402).send('<html>pay</html>'); });
  app.get('/ok', (req, res) => { res.status(200).json({}); });
  app.get('/custom', (req, res) => { res.setHeader('payment-required', encoded); res.status(402).json({ error: 'custom' }); });
  const srv = app.listen(0);
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test('an unpaid 402 with an empty body carries the decoded challenge instead', async () => {
  const { srv, base } = serve();
  try {
    const r = await fetch(`${base}/unpaid`);
    assert.equal(r.status, 402);
    assert.equal(r.headers.get('payment-required'), encoded, 'the header is untouched');
    const body = await r.json();
    assert.deepEqual(body, CHALLENGE, 'the body is exactly the decoded header');
  } finally { srv.close(); }
});

test('nothing else is touched', async () => {
  const { srv, base } = serve();
  try {
    assert.deepEqual(await (await fetch(`${base}/no-header`)).json(), {}, '402 without a header stays empty');
    assert.deepEqual(await (await fetch(`${base}/bad-header`)).json(), {}, 'an undecodable header falls back to the empty body');
    assert.equal(await (await fetch(`${base}/paywall`)).text(), '<html>pay</html>', 'the HTML paywall is untouched');
    assert.deepEqual(await (await fetch(`${base}/ok`)).json(), {}, 'a 200 with an empty body is untouched');
    assert.deepEqual(await (await fetch(`${base}/custom`)).json(), { error: 'custom' }, 'a non-empty 402 body is untouched');
  } finally { srv.close(); }
});
