// The documents an agent reaches for, and whether it can actually reach them.
//
// surfaces.test.js already asserts the route lists agree with each other. This
// asserts the things that were wrong on 25 August and that no list comparison
// would have caught: the discovery document carried no CORS header, so an agent
// running in a browser could not read it at all; openapi.json declared no
// servers array, so a generated client had no base URL; and robots.txt and
// sitemap.xml both 404'd on a service whose whole strategy is being found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const boot = async () => {
  const { app } = createApp();
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
};

test('the public documents are readable cross-origin', async () => {
  const { srv, base } = await boot();
  try {
    for (const p of ['/openapi.json', '/llms.txt', '/.well-known/x402.json', '/.well-known/signing-key.json']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} must be served`);
      assert.equal(res.headers.get('access-control-allow-origin'), '*',
        `${p} is a public document; a browser must be able to fetch it`);
    }
  } finally { srv.close(); }
});

test('a preflight is answered, or the browser never sends the real request', async () => {
  const { srv, base } = await boot();
  try {
    const res = await fetch(base + '/.well-known/x402.json', { method: 'OPTIONS', headers: {
      origin: 'https://pulse.chainverdict.xyz',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'cache-control',
    } });
    assert.ok(res.status === 204 || res.status === 200, 'the preflight must be answered');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-headers'),
      'without allow-headers the browser rejects the preflight and the GET never happens');
  } finally { srv.close(); }
});

test('openapi.json names a server', async () => {
  const { srv, base } = await boot();
  try {
    const oa = await (await fetch(base + '/openapi.json')).json();
    assert.ok(Array.isArray(oa.servers) && oa.servers.length,
      'without servers, a generated client has no base URL to call');
  } finally { srv.close(); }
});

test('a crawler policy and a sitemap exist', async () => {
  const { srv, base } = await boot();
  try {
    const r = await fetch(base + '/robots.txt');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Sitemap:/i);
    const sm = await fetch(base + '/sitemap.xml');
    assert.equal(sm.status, 200);
    assert.match(await sm.text(), /<urlset/);
  } finally { srv.close(); }
});

test('the landing page lists every route the service actually sells', async () => {
  const { srv, base } = await boot();
  try {
    const disc = await (await fetch(base + '/.well-known/x402.json')).json();
    const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
    // GET and POST on one path are one row to a human, so compare distinct paths.
    for (const p of [...new Set(disc.endpoints.map((e) => e.path))])
      assert.ok(html.includes(p),
        `${p} is sold but the landing page does not mention it — a human reading the site cannot see it`);
  } finally { srv.close(); }
});
