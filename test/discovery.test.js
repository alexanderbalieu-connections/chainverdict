// Discovery surfaces, asserted against what is actually served.
//
// Two defects this file exists to prevent, both found on 25 August, both
// returning HTTP 200:
//   1. The root descriptor advertised 23 paid routes (it included POST /mcp)
//      while openapi.json, x402.json and llms.txt all advertised 22. The same
//      filter was written in two places and forgotten in a third.
//   2. /.well-known/x402.json carried no CORS header, so no agent running in a
//      browser could read this service's discovery document at all — while
//      x402pulse, which sets the header, was readable. A discovery document a
//      browser cannot fetch is not discoverable.
import test from 'node:test';
import assert from 'node:assert/strict';

// ESM hoists every static import above the module body, so setting this after an
// `import { app }` line would run too late and the real server would bind a port
// during the test run. The dynamic import is what makes the guard effective.
process.env.CV_NO_LISTEN = '1';
process.env.PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || '0x0000000000000000000000000000000000000001';
const { app } = await import('../src/index.js');

const boot = async () => {
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
};
// x402 discovery writes a path parameter as /v1/x/*, OpenAPI writes it as
// /v1/x/{id}. Same route, two notations — compare them normalised or every
// parameterised route reads as undocumented.
const norm = (p) => String(p).split('/')
  .map((seg) => (seg === '*' || /^\{.*\}$/.test(seg) ? '*' : seg)).join('/');

test('every priced route is in the OpenAPI spec, and the spec names a server', async () => {
  const { srv, base } = await boot();
  try {
    const disc = await (await fetch(base + '/.well-known/x402.json')).json();
    const oa = await (await fetch(base + '/openapi.json')).json();
    const documented = new Set(Object.keys(oa.paths || {}).map(norm));
    for (const r of disc.resources)
      assert.ok(documented.has(norm(r.path)), `${r.path} is sold but absent from openapi.json`);
    assert.ok(Array.isArray(oa.servers) && oa.servers.length,
      'a generated client needs a base URL; openapi.json must declare servers');
  } finally { srv.close(); }
});

test('the root descriptor advertises the same number of routes as discovery', async () => {
  const { srv, base } = await boot();
  try {
    const root = await (await fetch(base + '/', { headers: { accept: 'application/json' } })).json();
    const disc = await (await fetch(base + '/.well-known/x402.json')).json();
    assert.equal(root.endpoints.length, disc.resources.length,
      'root and x402.json must not disagree about how many routes this service sells');
    assert.ok(root.mcp, 'MCP is filtered out of the resource lists, so it must still be advertised as a capability');
  } finally { srv.close(); }
});

test('the public documents are readable by a browser', async () => {
  const { srv, base } = await boot();
  try {
    for (const p of ['/openapi.json', '/llms.txt', '/.well-known/x402.json', '/v1/methodology']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} must be served`);
      assert.equal(res.headers.get('access-control-allow-origin'), '*',
        `${p} is a public document and must be fetchable cross-origin`);
    }
  } finally { srv.close(); }
});

test('a crawler policy and a sitemap exist', async () => {
  const { srv, base } = await boot();
  try {
    const r = await fetch(base + '/robots.txt');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Sitemap:/i, 'robots.txt must point at the sitemap');
    const sm = await fetch(base + '/sitemap.xml');
    assert.equal(sm.status, 200);
    assert.match(await sm.text(), /<urlset/, 'sitemap.xml must be a sitemap');
  } finally { srv.close(); }
});

test('www is redirected to one canonical host', async () => {
  const { srv, base } = await boot();
  try {
    // fetch() refuses to set a Host header, so drive the same code path the way
    // the proxy in front of this service does.
    const res = await fetch(base + '/llms.txt', { redirect: 'manual',
      headers: { 'x-forwarded-host': 'www.chainverdict.xyz' } });
    assert.equal(res.status, 301, 'www and the apex must not both serve the same document');
    assert.equal(res.headers.get('location'), 'https://chainverdict.xyz/llms.txt');
    // a host with nothing after the prefix must not produce https:///
    const odd = await fetch(base + '/llms.txt', { redirect: 'manual',
      headers: { 'x-forwarded-host': 'www.' } });
    assert.notEqual(odd.status, 301, 'a malformed host must not be redirected to https:///');
  } finally { srv.close(); }
});
