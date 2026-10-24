// Every discovery surface must describe the same set of paid routes.
//
// Audit, 24 August: portfolio.json said TradeRails had 9 paid routes, llms.txt
// listed 8, /.well-known/x402.json listed 7 and openapi.json listed 7 paths.
// GET /v1/gtin/checkdigit returned 402 — live, charging, and absent from both
// machine-readable surfaces, which are the ones an agent discovers through and
// the ones the Bazaar syncs from. Nothing errored; every list was internally
// plausible; three of them were wrong.
//
// These assertions compare the SERVED surfaces against the SERVED route table,
// which is the only comparison that would have caught it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const boot = async () => {
  const { app } = createApp();
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
};
const get = async (base, p) => (await fetch(base + p)).json();

test('x402.json, openapi.json and llms.txt describe the same paid routes', async () => {
  const { srv, base } = await boot();
  try {
    const x402 = await get(base, '/.well-known/x402.json');
    const oas = await get(base, '/openapi.json');
    const llms = await (await fetch(base + '/llms.txt')).text();

    const x402Keys = new Set(x402.endpoints.map((e) => `${e.method} ${e.path}`));
    assert.ok(x402Keys.size >= 9, `x402.json lists only ${x402Keys.size} routes`);

    // openapi must carry every route x402 advertises, as the same method
    for (const key of x402Keys) {
      const [method, path] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
      assert.ok(oas.paths[path], `openapi.json is missing ${path}`);
      assert.ok(oas.paths[path][method.toLowerCase()], `openapi.json is missing ${method} ${path}`);
    }
    // ...and nothing extra, or openapi advertises a route that cannot be paid for
    for (const [path, ops] of Object.entries(oas.paths)) {
      for (const method of Object.keys(ops)) {
        assert.ok(x402Keys.has(`${method.toUpperCase()} ${path}`), `openapi.json advertises ${method.toUpperCase()} ${path}, which x402.json does not`);
      }
    }
    // llms.txt must name every one of them
    for (const key of x402Keys) {
      assert.ok(llms.includes(key.slice(key.indexOf(' ') + 1)), `llms.txt does not mention ${key}`);
    }
  } finally { srv.close(); }
});

test('every advertised paid route is actually registered and priced', async () => {
  const { srv, base } = await boot();
  try {
    const x402 = await get(base, '/.well-known/x402.json');
    const router = (await import('../server.js')).createApp().app;
    const stack = (router.router || router._router)?.stack ?? [];
    const registered = new Set(stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`)));
    for (const e of x402.endpoints) {
      assert.ok(registered.has(`${e.method} ${e.path}`), `x402.json advertises ${e.method} ${e.path}, which is not a route`);
      assert.match(String(e.price), /^\$\d/, `${e.path} has no usable price`);
    }
  } finally { srv.close(); }
});
