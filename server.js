import { settlementBuffer } from './lib/settlement-buffer.js';
import { settlementEvidence } from './lib/settlement-evidence.js';
import { rejectPaidHead } from './lib/reject-paid-head.js';
// TradeRails — deterministic trade & logistics primitives for commerce agents.
// Maintained physical-supply-chain utilities: GTIN/GS1
// barcode validation, GS1 element-string decoding, container (ISO 6346) and
// ship (IMO) check digits, and HS-code triage. Every answer is pure public-
// spec math (with versioned reference tables) and Ed25519-signed.

import express from 'express';
import { readFileSync } from 'node:fs';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createFacilitatorConfig } from '@coinbase/x402';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateGtin, computeGtinCheckDigit, validateSscc, validateContainer, validateImo,
} from './src/identifiers.js';
import { lookupPrefix, decodeGs1 } from './src/gs1.js';
import { classifyHs } from './src/hs.js';
import { Signer } from './src/sign.js';
import { buildEvidence, methodologyDocument, METHODOLOGY_VERSION } from './src/evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config = {}) {
  const {
    payTo = process.env.PAY_TO_ADDRESS || null,
    network = process.env.X402_NETWORK || 'eip155:8453',
    facilitatorUrl = process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
    signingKey = process.env.SIGNING_KEY_PKCS8_B64 || null,
    prices = {
      identifier: process.env.PRICE_IDENTIFIER || '$0.004',
      decode: process.env.PRICE_DECODE || '$0.006',
      hs: process.env.PRICE_HS || '$0.05',
    },
    log = (...a) => console.log('[traderails]', ...a),
    syncFacilitatorOnStart = true,
    retired = process.env.TRADERAILS_RETIRED === 'true',
  } = config;

  const signer = new Signer(signingKey);
  if (signer.ephemeral) log('WARNING: signing key is ephemeral (set SIGNING_KEY_PKCS8_B64 to pin it)');
  const app = express();
  const settlementRecords = settlementBuffer({ host: 'trade.chainverdict.xyz' });
  settlementRecords.install(app);
  app.set('trust proxy', true); // Render terminates TLS at its proxy; without this req.protocol is 'http' and CDP rejects the bazaar declaration
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // CORS on the public documents. A discovery document a browser cannot read is
  // not discoverable: an agent running in a page, and this portfolio's own status
  // dashboard, got an opaque CORS failure instead of the spec. Public documents,
  // no credentials, no side effects — nothing here to protect.
  const PUBLIC_DOCS = new Set([
    '/', '/openapi.json', '/llms.txt', '/health', '/robots.txt', '/sitemap.xml', '/retirement.json',
    '/.well-known/x402.json', '/.well-known/signing-key.json',
  ]);
  app.use((req, res, next) => {
    if (!PUBLIC_DOCS.has(req.path)) return next();
    res.set('access-control-allow-origin', '*');
    // A GET carrying any header outside the CORS safelist — cache-control, for
    // one — is not a simple request: the browser sends an OPTIONS preflight and
    // will not make the real call unless the preflight answers with these. The
    // allow-origin header above was correct and unreachable.
    res.set('access-control-allow-headers', '*');
    res.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    res.set('access-control-max-age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  const paidMode = Boolean(payTo) && !retired;
  const lifecycle = {
    status: retired ? 'retired' : 'maintenance',
    noticePublished: '2026-10-03', reviewOn: '2026-10-31',
    retirementNoEarlierThan: '2026-11-02', automaticRetirement: false,
    message: retired
      ? 'TradeRails paid routes are retired. No payment is requested or settled.'
      : 'TradeRails is in maintenance and under retirement review. Existing routes and prices remain available. Any retirement will be manually reviewed, no earlier than 2 November 2026.',
    contact: 'contact@chainverdict.xyz', notice: '/retirement.json',
    source: 'https://github.com/alexanderbalieu-connections/traderails',
  };

  // Wrap a computed result with a signed envelope.
  const signed = (kind, data) => {
    const _evidence = buildEvidence(kind);
    const body = _evidence ? { ...data, _evidence } : { ...data };
    const payload = { kind, ...body, iss: 'traderails', iat: Math.floor(Date.now() / 1000) };
    return { ...body, _attestation: { jws: signer.sign(payload), keyId: signer.keyId, verify: '/.well-known/signing-key.json' } };
  };


// ---- ONE paid-route table --------------------------------------------------
// x402.json, the payment middleware and openapi.json each kept their own list of
// paid routes. They drifted: GET /v1/gtin/checkdigit was live and charging, yet
// missing from BOTH x402.json and openapi.json — the two surfaces an agent
// actually discovers through, and the ones the Bazaar syncs from — while POST
// /v1/gs1/decode sat in openapi.json with no price at all. Three surfaces, three
// different route counts, and the only correct number lived in the portfolio
// manifest on another host.
//
// Discovery, charging and documentation derive from this one route table.
const ROUTE_TABLE = {
  'GET /v1/gtin/validate':      { price: 'identifier', description: 'Validate a GTIN-8/12/13/14, UPC-A or EAN-13: check digit, format, GTIN-14 normalization, packaging indicator.' },
  'GET /v1/gtin/checkdigit':    { price: 'identifier', description: 'Compute the GS1 check digit for a code body missing it.' },
  'GET /v1/gtin/prefix':        { price: 'identifier', description: 'Resolve a GTIN/EAN prefix to its GS1 Member Organisation (not country of origin).' },
  'GET /v1/sscc/validate':      { price: 'identifier', description: 'Validate an SSCC-18 logistics-unit serial shipping container code.' },
  'GET /v1/container/validate': { price: 'identifier', description: 'Validate an ISO 6346 shipping container number (owner, category, serial, check digit).' },
  'GET /v1/imo/validate':       { price: 'identifier', description: 'Validate an IMO ship identification number check digit.' },
  'GET /v1/gs1/decode':         { price: 'decode',     description: 'Decode a GS1 element string / GS1-128 / DataMatrix AI payload into structured fields (GTIN, batch, expiry, serial, weights) with per-AI validation. Accepts human "(01)...(17)..." or raw FNC1 form.' },
  'POST /v1/gs1/decode':        { price: 'decode',     description: 'Decode a GS1 element string (POST body { data }).' },
  'GET /v1/hs/classify':        { price: 'hs',         description: 'Deterministic HS-code triage: ranked candidate headings with official heading text, GRI note and broker disclaimer. Not a customs ruling.' },
};
// ---- Bazaar discovery -----------------------------------------------------
// The CDP facilitator only catalogs a route that declares extensions.bazaar.
// Each declaration carries a working example so an agent can call it correctly.
const BZ = {
  'GET /v1/gtin/validate':      { in: { code: '4006381333931' },  d: 'GTIN-8/12/13/14, UPC-A or EAN-13 to validate', out: { valid: true, format: 'EAN-13 (GTIN-13)' } },
  'GET /v1/gtin/checkdigit':    { in: { body: '400638133393' },   k: 'body', d: 'GS1 key body without its check digit', out: { checkDigit: 1 } },
  'GET /v1/gtin/prefix':        { in: { code: '4006381333931' },  d: 'GTIN or prefix to resolve to a GS1 Member Organisation', out: { memberOrganisation: 'GS1 Germany' } },
  'GET /v1/sscc/validate':      { in: { code: '106141411928374657' }, d: 'SSCC-18 logistics unit code', out: { valid: true } },
  'GET /v1/container/validate': { in: { code: 'CSQU3054383' },    d: 'ISO 6346 shipping container number', out: { valid: true, ownerCode: 'CSQ' } },
  'GET /v1/imo/validate':       { in: { code: 'IMO 9074729' },    d: 'IMO ship identification number', out: { valid: true } },
  'GET /v1/gs1/decode':         { in: { data: '(01)04006381333931(17)261231(10)LOT1' }, k: 'data', d: 'GS1 element string / GS1-128 payload', out: { valid: true, elements: [] } },
  'POST /v1/gs1/decode':        { body: { data: '(01)04006381333931(17)261231(10)LOT1' }, out: { valid: true, elements: [] } },
  'GET /v1/hs/classify':        { in: { q: 'running shoes' },     k: 'q', d: 'Goods description to triage against HS-2022 headings', out: { candidates: [], confidence: 'high' } },
};
function bzExt(route) {
  const m = BZ[route]; if (!m) return undefined;
  try {
    if (m.body) return declareDiscoveryExtension({ bodyType: 'json', input: m.body, output: { example: m.out, schema: { type: 'object', additionalProperties: true } } });
    const key = m.k || Object.keys(m.in)[0];
    return declareDiscoveryExtension({
      input: m.in,
      inputSchema: { type: 'object', properties: { [key]: { type: 'string', description: m.d } }, required: [key] },
      output: { example: m.out, schema: { type: 'object', additionalProperties: true } },
    });
  } catch (e) { console.error(`[traderails] bazaar declaration failed for ${route}:`, e.message); return undefined; }
}

  // A manual retirement switch intercepts the same route table BEFORE payment.
  // No date-based switch: a review and coordinated portfolio update are required.
  for (const rk of Object.keys(ROUTE_TABLE)) {
    const [method, route] = rk.split(' ');
    app[method.toLowerCase()](route, (req, res, next) => {
      res.set('Link', '</retirement.json>; rel="deprecation"');
      if (!retired) return next();
      res.status(410).json(signed('service.retired', {
        error: 'service_retired', route: rk, lifecycle,
      }));
    });
  }

  const settlements = settlementEvidence({ service: 'traderails', onRecord: r => settlementRecords.add(r), routeKeys: Object.keys(ROUTE_TABLE), log: message => log(message) });
  if (!retired) app.use(settlements.middleware);
  if (!retired) app.use(rejectPaidHead(Object.keys(ROUTE_TABLE)));

  if (paidMode) {
    let facilitatorClient = config.facilitatorClient ?? null;
    if (!facilitatorClient) {
      const cdpKeyId = process.env.CDP_API_KEY_ID || null;
      const cdpKeySecret = process.env.CDP_API_KEY_SECRET || null;
      if (cdpKeyId && cdpKeySecret) {
        const cdp = createFacilitatorConfig(cdpKeyId, cdpKeySecret);
        facilitatorClient = new HTTPFacilitatorClient(cdp);
        log(`facilitator: Coinbase CDP (${cdp.url})`);
      } else {
        facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
        log(`facilitator: ${facilitatorUrl} (set CDP_API_KEY_ID/SECRET for Coinbase CDP + Bazaar indexing)`);
      }
    }
    const resourceServer = new x402ResourceServer(facilitatorClient).register(network, new ExactEvmScheme());
    settlements.attach(resourceServer);
    const P = (price) => ({ accepts: { scheme: 'exact', price, network, payTo } });
    const routes = Object.fromEntries(Object.entries(ROUTE_TABLE).map(([rk, m]) => [
      rk, { ...P(prices[m.price]), description: m.description, mimeType: 'application/json' },
    ]));
    for (const [rk, cfg] of Object.entries(routes)) {
      const ext = bzExt(rk);
      if (ext) cfg.extensions = ext;
    }
    const declared = Object.values(routes).filter(r => r.extensions?.bazaar).length;
    log(`bazaar discovery declared on ${declared}/${Object.keys(routes).length} routes`);
    app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, syncFacilitatorOnStart));
    log(`paid mode: settling to ${payTo} on ${network}`);
  } else {
    log(retired ? 'RETIRED: payment middleware disabled' : 'FREE MODE: PAY_TO_ADDRESS not set — paid routes are open (dev/test only)');
  }

  // ---------- paid handlers ----------
  if (!retired) {
  app.get('/v1/gtin/validate', (req, res) => res.json(signed('gtin.validate', validateGtin(req.query.code || ''))));
  app.get('/v1/gtin/checkdigit', (req, res) => {
    try { res.json(signed('gtin.checkdigit', { body: req.query.body, checkDigit: computeGtinCheckDigit(req.query.body || '') })); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/v1/gtin/prefix', (req, res) => res.json(signed('gtin.prefix', lookupPrefix(req.query.code || ''))));
  app.get('/v1/sscc/validate', (req, res) => res.json(signed('sscc.validate', validateSscc(req.query.code || ''))));
  app.get('/v1/container/validate', (req, res) => res.json(signed('container.validate', validateContainer(req.query.code || ''))));
  app.get('/v1/imo/validate', (req, res) => res.json(signed('imo.validate', validateImo(req.query.code || ''))));
  const decodeHandler = (data, res) => res.json(signed('gs1.decode', decodeGs1(String(data || ''))));
  app.get('/v1/gs1/decode', (req, res) => decodeHandler(req.query.data, res));
  app.post('/v1/gs1/decode', (req, res) => decodeHandler(req.body?.data, res));
  app.get('/v1/hs/classify', (req, res) => res.json(signed('hs.classify', classifyHs(req.query.q || req.query.description || '', Number(req.query.limit) || 5))));

  }

  // ---------- free routes ----------
  app.get('/retirement.json', (req, res) => res.json(signed('service.lifecycle', lifecycle)));
  app.get('/v1/methodology', (req, res) => res.json(methodologyDocument()));
  app.get('/health', (req, res) => res.json({ ok: true, service: 'traderails', mode: retired ? 'retired' : paidMode ? 'paid' : 'free', keyId: signer.keyId }));
  app.get('/healthz', (req, res) => res.json({ ok: true, service: 'traderails', mode: retired ? 'retired' : paidMode ? 'paid' : 'free' }));
  // CORS: the public verifier page is served from one origin but must fetch the
  // published key from every service. A public signing key is public by
  // definition — without this header the browser blocks the fetch and receipts
  // from this service silently show as unverifiable.
  app.get('/.well-known/signing-key.json', (req, res) => {
    res.set('access-control-allow-origin', '*');
    res.json(signer.wellKnown());
  });

  app.get('/.well-known/x402.json', (req, res) => {
    res.json({
      x402Version: 2,
      name: 'TradeRails',
      description: 'Deterministic trade & logistics primitives for commerce agents.',
      lifecycle,
      endpoints: (retired ? [] : Object.entries(ROUTE_TABLE)).map(([rk, m]) => {
        const i = rk.indexOf(' ');
        return { path: rk.slice(i + 1), price: prices[m.price], method: rk.slice(0, i) };
      }),
      network, payTo: retired ? null : payTo || null,
    });
  });

  app.get('/llms.txt', (req, res) => {
    if (retired) return res.type('text/plain').send('# TradeRails — retired\nPaid routes return signed HTTP 410. No payment is accepted.\nSee /retirement.json and /.well-known/signing-key.json.\n');
    res.type('text/plain').send(`# TradeRails
Maintenance notice: ${lifecycle.message} See /retirement.json.
Deterministic trade & logistics primitives for commerce agents. USDC on Base via x402, no keys, no signup.
Every paid response is Ed25519-signed (compact JWS) and re-verifiable offline against /.well-known/signing-key.json.
Pure public-spec math (GS1 General Specifications, ISO 6346, IMO): deterministic checks with no LLM in the serving path. Reference tables and specifications can change; this is not a customs ruling.

## Endpoints
- GET /v1/gtin/validate?code=  (${prices.identifier}) — validate GTIN-8/12/13/14, UPC-A, EAN-13: check digit, format, GTIN-14, indicator.
- GET /v1/gtin/checkdigit?body=  (${prices.identifier}) — compute the GS1 check digit for a body missing it.
- GET /v1/gtin/prefix?code=  (${prices.identifier}) — GS1 Member Organisation for a prefix (NOT country of origin).
- GET /v1/sscc/validate?code=  (${prices.identifier}) — SSCC-18 logistics-unit code.
- GET /v1/container/validate?code=  (${prices.identifier}) — ISO 6346 shipping container number (e.g. CSQU3054383).
- GET /v1/imo/validate?code=  (${prices.identifier}) — IMO ship identification number.
- GET /v1/gs1/decode?data=  (${prices.decode}) — decode GS1 element string / GS1-128 (AIs: GTIN, batch, expiry, serial, weight). Human "(01)...(17)..." or raw FNC1.
- POST /v1/gs1/decode  (${prices.decode}) — same decode, GS1 payload in a JSON body { data } instead of the query string.
- GET /v1/hs/classify?q=  (${prices.hs}) — HS-code triage: ranked candidate headings + official text + GRI note. Informational, not a customs ruling.

## Discovery
- OpenAPI: /openapi.json
- x402: /.well-known/x402.json
- Signing key: /.well-known/signing-key.json
`);
  });

  app.get('/openapi.json', (req, res) => {
    const document = openapi(prices);
    document['x-lifecycle'] = lifecycle;
    if (retired) { document.paths = {}; document.info.description = lifecycle.message; }
    res.json(document);
  });

  // Both of these returned 404 on a service that depends on being found.
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(
`User-agent: *
Allow: /

# Agent-readable entry points
# llms.txt: https://trade.chainverdict.xyz/llms.txt
# OpenAPI:  https://trade.chainverdict.xyz/openapi.json
# x402:     https://trade.chainverdict.xyz/.well-known/x402.json

Sitemap: https://trade.chainverdict.xyz/sitemap.xml
`));
  app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/retirement.json', '/llms.txt', '/openapi.json', '/.well-known/x402.json']
  .map((u) => `  <url><loc>https://trade.chainverdict.xyz${u}</loc></url>`).join('\n')}
</urlset>
`));
  // Serve the same lifecycle notice for both homepage URLs, even after retirement.
  app.get(['/', '/index.html'], (req, res) => {
    if (retired) return res.type('html').send('<!doctype html><html lang="en"><title>TradeRails retired</title><main><h1>TradeRails has retired</h1><p>Paid routes return signed HTTP 410. No payment is accepted.</p><a href="/retirement.json">Retirement record</a> · <a href="/.well-known/signing-key.json">Verify earlier receipts</a></main></html>');
    res.type('html').send(readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (e) => {
      if (e) res.json({ service: 'traderails', see: '/llms.txt' });
    });
  });

  return { app, signer };
}

function openapi(prices) {
  return {
    openapi: '3.0.3',
    info: { contact: { email: 'contact@chainverdict.xyz' }, title: 'TradeRails', version: '1.0.0', description: 'Deterministic trade & logistics primitives for commerce agents. Paid per call in USDC on Base via x402.' },
    // Without this a generated client has no base URL: the spec declares only
    // relative paths, so tooling either guesses or fails. x402.json carried the
    // host all along; the OpenAPI document did not.
    servers: [{ url: 'https://trade.chainverdict.xyz' }],
    paths: {
      '/v1/gtin/validate': { get: { summary: `Validate a GTIN (${prices.identifier})`, parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/gtin/checkdigit': { get: { summary: `Compute the GS1 check digit for a body missing it (${prices.identifier})`, parameters: [{ name: 'body', in: 'query', required: true, schema: { type: 'string' }, example: '400638133393' }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { checkDigit: { type: 'integer' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/gtin/prefix': { get: { summary: `GS1 Member Organisation for a prefix (${prices.identifier})`, parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/sscc/validate': { get: { summary: `Validate SSCC-18 (${prices.identifier})`, parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/container/validate': { get: { summary: `Validate ISO 6346 container (${prices.identifier})`, parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/imo/validate': { get: { summary: `Validate IMO ship number (${prices.identifier})`, parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/gs1/decode': { post: { summary: `Decode GS1 element string, POST body (${prices.decode})`, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'string', example: '(01)04006381333931(17)261231(10)LOT1' } } } } } }, responses: { '200': { description: 'OK' } } }, get: { summary: `Decode GS1 element string (${prices.decode})`, parameters: [{ name: 'data', in: 'query', required: true, schema: { type: 'string' }, example: '(01)04006381333931(17)261231(10)LOT1' }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
      '/v1/hs/classify': { get: { summary: `HS-code triage (${prices.hs})`, parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, _attestation: { type: 'object' } }, additionalProperties: true } } } } } } },
    },
  };
}

// ---- start server when run directly (Render sets PORT) ----
import { fileURLToPath as _f } from 'node:url';
if (process.argv[1] === _f(import.meta.url)) {
  const { app } = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`[traderails] listening on :${port}`));
}
