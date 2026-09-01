// Every price printed on the human landing page must equal the price the
// server actually quotes in its 402.
//
// The defect this file exists to prevent, found on 1 September 2026 by reading
// the live 402 header rather than the page: GET /v1/token/verdict quoted
// amount "10000" ($0.01) on the wire and in the Bazaar catalogue, while
// landing.html printed $0.02 in two places -- the rate-card row and the
// worked "one purchase, on the wire" example. The flagship endpoint was
// misquoted by 2x on its own homepage, and every automated check passed,
// because no check ever compared the page to the price map.
//
// This test reads landing.html as text and the PRICES map from the running
// app's own descriptor, so it cannot drift the way two hand-maintained lists do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.CV_NO_LISTEN = '1';
process.env.PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || '0x0000000000000000000000000000000000000001';
const { app } = await import('../src/index.js');

const html = readFileSync(new URL('../src/landing.html', import.meta.url), 'utf8');

// The served root descriptor is the authority: it is generated from PRICES,
// which is what the payment middleware charges.
function rootEndpoints() {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: '/', path: '/', headers: { accept: 'application/json' }, hostname: 'chainverdict.xyz', get(h) { return this.headers[String(h).toLowerCase()]; } };
    const res = {
      statusCode: 200, headersSent: false, locals: {},
      set() { return this; }, setHeader() { return this; }, getHeader() {}, type() { return this; },
      status(c) { this.statusCode = c; return this; },
      send(b) { resolve(b); return this; },
      json(b) { resolve(b); return this; },
      end() { resolve(null); },
    };
    app(req, res, (e) => reject(e || new Error('root fell through')));
  });
}

test('every rate-card price equals the served price for that route', async () => {
  const root = await rootEndpoints();
  assert.ok(root && Array.isArray(root.endpoints), 'root descriptor has an endpoints array');

  const mismatches = [];
  for (const { route, price } of root.endpoints) {
    const [method, glob] = route.split(' ');
    if (!glob) continue;
    // landing.html writes GET /v1/token/verdict/{addr} where the map says .../*
    const base = glob.replace(/\/\*$/, '');
    const rowRe = new RegExp(
      '<td class="route">' + method + '\\s+' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?:/\\{[^}]*\\})?</td>.*?<td class="price">([^<]+)</td>'
    );
    const m = html.match(rowRe);
    if (!m) { mismatches.push(`${route}: no row on the landing page`); continue; }
    if (m[1].trim() !== price) mismatches.push(`${route}: page says ${m[1].trim()}, server quotes ${price}`);
  }
  assert.deepEqual(mismatches, [], 'landing page prices disagree with served prices');
});

test('the worked example in the hero quotes the real token/verdict price', async () => {
  const root = await rootEndpoints();
  const tv = root.endpoints.find((e) => e.route.startsWith('GET /v1/token/verdict'));
  assert.ok(tv, 'token/verdict is still sold');
  const m = html.match(/402 Payment Required[^<]*?(\$[0-9.]+)\s*USDC/);
  assert.ok(m, 'the hero still shows a 402 quote');
  assert.equal(m[1], tv.price, 'hero example price must be the real price');
});

test('the portfolio section lists every route the other two services sell', () => {
  const traderails = [
    '/v1/gtin/validate', '/v1/gtin/checkdigit', '/v1/gtin/prefix', '/v1/sscc/validate',
    '/v1/container/validate', '/v1/imo/validate', '/v1/gs1/decode', '/v1/hs/classify',
  ];
  const pulse = ['/v1/verdict', '/v1/rankings', '/v1/attest', '/v1/feed', '/v1/archive/full'];
  const missing = [...traderails, ...pulse].filter((p) => !html.includes(p));
  assert.deepEqual(missing, [], 'the main site must list the whole portfolio, not just its own routes');
});
