// The MCP tool surface must describe exactly what this service sells.
//
// The defect this file exists to prevent, found live on 1 September 2026: the
// Smithery registry listing advertised 21 tools including "OFAC sanctions
// screening $0.05" and "Pre-payment trust check $0.06" -- both withdrawn on
// 27 August, from a build deployed on 11 August. A public registry was
// offering, in the operator's name, the two services he retired precisely
// because an uninsured natural person should not sell them. Nothing in the
// repository could have caught it: the tool list and the price map were two
// hand-maintained lists, and no test compared them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_ROUTE, FREE_TOOLS, isPaidMcpCall } from '../src/mcp-http.js';

process.env.CV_NO_LISTEN = '1';
process.env.PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || '0x0000000000000000000000000000000000000001';
const { app } = await import('../src/index.js');

function root() {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: '/', path: '/', headers: { accept: 'application/json' }, hostname: 'chainverdict.xyz', get(h) { return this.headers[String(h).toLowerCase()]; } };
    const res = {
      statusCode: 200, headersSent: false, locals: {},
      set() { return this; }, setHeader() { return this; }, getHeader() {}, type() { return this; },
      status(c) { this.statusCode = c; return this; },
      send(b) { resolve(b); return this; }, json(b) { resolve(b); return this; }, end() { resolve(null); },
    };
    app(req, res, (e) => reject(e || new Error('root fell through')));
  });
}

test('every MCP tool maps to a route this service still sells', async () => {
  const sold = new Set((await root()).endpoints.map((e) => e.route));
  const orphaned = Object.entries(PRICE_ROUTE).filter(([, route]) => !sold.has(route));
  assert.deepEqual(orphaned.map(([t]) => t), [], 'MCP tools exist for routes that are no longer sold');
});

test('no sold route is missing an MCP tool', async () => {
  const sold = (await root()).endpoints.map((e) => e.route);
  const exposed = new Set(Object.values(PRICE_ROUTE));
  // batch/validate is deliberately HTTP-only: 500 identifiers do not belong in a
  // tool-call argument. Any OTHER gap is an oversight, not a decision.
  const allowed = new Set(['POST /v1/batch/validate']);
  const missing = sold.filter((r) => !exposed.has(r) && !allowed.has(r));
  assert.deepEqual(missing, [], 'sold routes with no MCP tool');
});

test('the withdrawn services have no tool anywhere', () => {
  const names = Object.keys(PRICE_ROUTE).join(' ');
  const routes = Object.values(PRICE_ROUTE).join(' ');
  for (const gone of ['screen_address_ofac', 'preflight_payee']) assert.ok(!names.includes(gone), `${gone} still registered`);
  for (const gone of ['/v1/screen/address', '/v1/preflight']) assert.ok(!routes.includes(gone), `${gone} still mapped`);
});

test('payment_info is free and everything else is paid', () => {
  assert.ok(FREE_TOOLS.has('payment_info'));
  assert.equal(isPaidMcpCall({ method: 'tools/call', params: { name: 'payment_info' } }), false);
  assert.equal(isPaidMcpCall({ method: 'tools/call', params: { name: 'token_verdict' } }), true);
  assert.equal(isPaidMcpCall({ method: 'tools/list' }), false);
  assert.equal(isPaidMcpCall({ method: 'initialize' }), false);
});
