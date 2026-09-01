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

// The README is now the public front door of a public repository, and it was
// four months stale: seven routes of twenty, token/verdict priced at $0.02
// against a real $0.01, "16 validator tests" against 34. Nobody noticed because
// no test had ever read it. Same defect as the landing page, different file.
test('every price in the README equals the served price', async () => {
  const { readFileSync } = await import('node:fs');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const root = await rootEndpoints();
  const mismatches = [];
  for (const { route, price } of root.endpoints) {
    const re = new RegExp('\\|\\s*`' + route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s*\\|\\s*([^|\\s]+)\\s*\\|');
    const m = readme.match(re);
    if (!m) { mismatches.push(`${route}: not in the README rate card`); continue; }
    if (m[1] !== price) mismatches.push(`${route}: README says ${m[1]}, server quotes ${price}`);
  }
  assert.deepEqual(mismatches, [], 'README prices disagree with served prices');
});

// Glama rejected the first submission because the README described "a set of
// paid RESTful APIs using x402, not an MCP server" -- true of the text, false of
// the software, which has served MCP over Streamable HTTP since August. A
// directory can only read what the README says.
test('the README says this is an MCP server', async () => {
  const { readFileSync } = await import('node:fs');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const term of ['MCP', 'Model Context Protocol', 'tools', 'Streamable HTTP', '/mcp']) {
    assert.ok(readme.includes(term), `README must mention ${term}`);
  }
});
