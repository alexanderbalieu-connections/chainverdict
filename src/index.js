import express from "express";
import TurndownService from "turndown";
import * as Diff from "diff";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { validateIBAN, validateVAT, validateBIC } from "./lib/validators.js";
import { tokenVerdict, walletDossier } from "./lib/chain.js";
import { handleMcpRequest, isPaidMcpCall } from "./mcp-http.js";
import { validateLEI, validateISIN, verifyToken, verifyPayment } from "./lib/institutional.js";
import { screenAddress, startSanctionsRefresher } from "./lib/sanctions.js";
import { signResponses, signingInfo } from "./lib/signing.js";
import { emailPosture, tlsPosture, typosquatCheck } from "./lib/security.js";
import { gasOracle, tokenSupply, tokenActivity, blockInfo, portfolio } from "./lib/onchain-data.js";
import { enrich } from "./lib/enrich.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const LANDING = readFileSync(join(__dir, "landing.html"), "utf8");

const app = express();
let mcpGate = null;
app.use(signResponses("/v1/"));
app.use(express.json({ limit: "2mb" }));

const PAY_TO = process.env.PAY_TO_ADDRESS;            // your Base wallet (public address only)
const RAW_NET = process.env.X402_NETWORK || "base";
const NETWORK = RAW_NET === "base" ? "eip155:8453" : RAW_NET === "base-sepolia" ? "eip155:84532" : RAW_NET; // CAIP-2 (x402 v2)
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const USE_CDP = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
const X402_ENABLED = process.env.X402_ENABLED !== "false";

// ---- Pricing (USDC) — tune freely, redeploys in seconds ----
// NOTE: x402 middleware matches "*" wildcards (not ":param").
const PRICES = {
  "GET /v1/token/verdict/*": "$0.02",
  "GET /v1/wallet/dossier/*": "$0.01",
  "GET /v1/validate/iban/*": "$0.001",
  "GET /v1/validate/vat/*": "$0.001",
  "GET /v1/validate/bic/*": "$0.001",
  "POST /v1/doc/html-to-markdown": "$0.002",
  "POST /v1/doc/diff": "$0.002",
  "POST /mcp": "$0.005",
  "GET /v1/screen/address/*": "$0.05",
  "GET /v1/verify/payment/*": "$0.02",
  "GET /v1/verify/token/*": "$0.005",
  "GET /v1/validate/lei/*": "$0.002",
  "GET /v1/validate/isin/*": "$0.001",
  "GET /v1/preflight/*": "$0.06",
  "POST /v1/batch/validate": "$0.10",
  "GET /v1/security/email/*": "$0.01",
  "GET /v1/security/tls/*": "$0.01",
  "GET /v1/security/typosquat/*": "$0.005",
  "GET /v1/data/gas": "$0.002",
  "GET /v1/data/block": "$0.001",
  "GET /v1/data/supply/*": "$0.003",
  "GET /v1/data/activity/*": "$0.005",
  "GET /v1/data/portfolio/*": "$0.004"
};

if (X402_ENABLED) {
  if (!PAY_TO) { console.error("PAY_TO_ADDRESS is required when X402_ENABLED"); process.exit(1); }
  const facilitatorClient = USE_CDP
    ? new HTTPFacilitatorClient(createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET))
    : new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());
  const routes = Object.fromEntries(
    Object.entries(PRICES).filter(([r]) => r !== "POST /mcp")
      .map(([route, price]) => [route, { accepts: { scheme: "exact", price, network: NETWORK, payTo: PAY_TO }, mimeType: "application/json" }])
  );
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, true));
  mcpGate = paymentMiddleware({ "POST /mcp": { accepts: { scheme: "exact", price: PRICES["POST /mcp"], network: NETWORK, payTo: PAY_TO }, mimeType: "application/json" } },
    resourceServer, undefined, undefined, false);
  console.log(`x402 enabled → payments to ${PAY_TO} on ${NETWORK} via ${USE_CDP ? "Coinbase CDP facilitator" : FACILITATOR_URL}`);
} else {
  console.log("x402 DISABLED (free mode for local testing)");
}

// ---- Free discovery endpoints (agents & humans) ----
app.get("/", (req, res) => {
  if ((req.headers.accept || "").includes("text/html")) return res.type("html").send(LANDING);
  res.json({
  service: "ChainVerdict",
  homepage: "https://chainverdict.xyz",
  description: "Pay-per-call APIs for autonomous agents: token safety verdicts, wallet dossiers, finance validators, doc utilities. x402/USDC on Base.",
  payment: { protocol: "x402", network: NETWORK, currency: "USDC" },
  endpoints: Object.entries(PRICES).map(([route, price]) => ({ route, price })),
  openapi: "/openapi.json",
  llms: "/llms.txt",
  attestation: "https://pulse.chainverdict.xyz/v1/attestations/latest?url=https://chainverdict.xyz/v1/data/block",
  x402_discovery: "/.well-known/x402.json",
  health: "/health"
  });
});
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/openapi.json", (_req, res) => res.json(openapiSpec()));
app.get("/.well-known/signing-key.json", (_req, res) => res.json(signingInfo()));
app.get("/llms.txt", (_req, res) => res.type("text/plain").send(
`# ChainVerdict
> Pay-per-call verdict APIs for autonomous agents. x402/USDC on Base via Coinbase CDP facilitator. No API keys, no accounts.

## Paid endpoints (x402, USDC on Base)
- GET https://chainverdict.xyz/v1/token/verdict/{address} — token safety verdict on Base, $0.02
- GET https://chainverdict.xyz/v1/wallet/dossier/{address} — wallet profile, $0.01
- GET https://chainverdict.xyz/v1/data/gas — live Base gas oracle (base fee, priority fees, congestion), $0.002
- GET https://chainverdict.xyz/v1/data/block — latest Base block info & utilization, $0.001
- GET https://chainverdict.xyz/v1/data/supply/{token} — token supply & burn distribution on Base, $0.003
- GET https://chainverdict.xyz/v1/data/activity/{token} — recent transfer count/volume/unique wallets, $0.005
- GET https://chainverdict.xyz/v1/data/portfolio/{address} — ETH + canonical token balances, $0.004
- GET https://chainverdict.xyz/v1/security/email/{domain} — SPF/DMARC/DKIM email-spoofing posture, $0.01
- GET https://chainverdict.xyz/v1/security/tls/{domain} — live TLS certificate validity/expiry check, $0.01
- GET https://chainverdict.xyz/v1/security/typosquat/{domain} — brand look-alike/homoglyph structural check, $0.005
- GET https://chainverdict.xyz/v1/preflight/{address} — one-call pre-payment trust check (sanctions + wallet profile + verdict), $0.06
- POST https://chainverdict.xyz/v1/batch/validate — batch-validate up to 500 IBAN/VAT/BIC/LEI/ISIN items, $0.10
- GET https://chainverdict.xyz/v1/screen/address/{address} — OFAC SDN sanctions screening (daily-refreshed), $0.05
- GET https://chainverdict.xyz/v1/verify/payment/{txhash} — on-chain ERC-20 settlement verification on Base, $0.02
- GET https://chainverdict.xyz/v1/verify/token/{addressOrSymbol} — canonical token verification on Base, $0.005
- GET https://chainverdict.xyz/v1/validate/lei/{lei} — ISO 17442 LEI validation, $0.002
- GET https://chainverdict.xyz/v1/validate/isin/{isin} — ISO 6166 ISIN validation, $0.001
- GET https://chainverdict.xyz/v1/validate/iban/{iban} — IBAN mod-97 validation, $0.001
- GET https://chainverdict.xyz/v1/validate/vat/{vat} — EU VAT format+checksum validation, $0.001
- GET https://chainverdict.xyz/v1/validate/bic/{bic} — BIC/SWIFT validation, $0.001
- POST https://chainverdict.xyz/v1/doc/html-to-markdown — HTML to Markdown, $0.002
- POST https://chainverdict.xyz/v1/doc/diff — structured text diff, $0.002

## Machine-readable
- OpenAPI: https://chainverdict.xyz/openapi.json
- x402 discovery: https://chainverdict.xyz/.well-known/x402.json
- Response signing key (Ed25519, all /v1/* responses signed): https://chainverdict.xyz/.well-known/signing-key.json
- Independent quality attestation (Ed25519-signed, refreshed daily by x402pulse): https://pulse.chainverdict.xyz/v1/attestations/latest?url=https://chainverdict.xyz/v1/data/block
`));
app.get("/.well-known/x402.json", (_req, res) => res.json({
  x402Version: 2,
  name: "ChainVerdict",
  description: "Pay-per-call verdict APIs for autonomous agents on Base.",
  url: "https://chainverdict.xyz",
  network: NETWORK,
  currency: "USDC",
  payTo: PAY_TO || null,
  resources: Object.entries(PRICES).filter(([r]) => r !== "POST /mcp").map(([route, price]) => {
    const [method, path] = route.split(" ");
    return { method, path, price, discoverable: true };
  }),
  openapi: "https://chainverdict.xyz/openapi.json",
  contact: "https://chainverdict.xyz"
}));

// ---- Paid: on-chain verdicts ----
app.get("/v1/token/verdict/:address", async (req, res) => {
  try { res.json(enrich("token/verdict", await tokenVerdict(req.params.address))); }
  catch (e) { res.status(502).json({ error: "chain_read_failed", detail: String(e.message || e) }); }
});
app.get("/v1/wallet/dossier/:address", async (req, res) => {
  try { res.json(enrich("wallet/dossier", await walletDossier(req.params.address))); }
  catch (e) { res.status(502).json({ error: "chain_read_failed", detail: String(e.message || e) }); }
});

// ---- Paid: deterministic validators ----
app.get("/v1/validate/iban/:iban", (req, res) => res.json(enrich("iban", validateIBAN(req.params.iban))));
app.get("/v1/validate/vat/:vat", (req, res) => res.json(enrich("vat", validateVAT(req.params.vat))));
app.get("/v1/validate/bic/:bic", (req, res) => res.json(enrich("bic", validateBIC(req.params.bic))));

// ---- Paid: institutional trust & compliance suite ----
app.get("/v1/screen/address/:addr", (req, res) => res.json(enrich("screen/address", screenAddress(req.params.addr))));
app.get("/v1/verify/payment/:tx", async (req, res) => {
  try { res.json(enrich("verify/payment", await verifyPayment(req.params.tx))); }
  catch (e) { res.status(502).json({ error: "chain_read_failed", detail: String(e.message || e) }); }
});
app.get("/v1/verify/token/:q", (req, res) => res.json(enrich("verify/token", verifyToken(req.params.q))));
app.get("/v1/validate/lei/:lei", (req, res) => res.json(enrich("lei", validateLEI(req.params.lei))));
app.get("/v1/validate/isin/:isin", (req, res) => res.json(enrich("isin", validateISIN(req.params.isin))));

// ---- Paid: one-call pre-payment trust check ----
app.get("/v1/preflight/:addr", async (req, res) => {
  try {
    const [screen, dossier] = await Promise.all([
      Promise.resolve(screenAddress(req.params.addr)),
      walletDossier(req.params.addr).catch(e => ({ error: "dossier_failed", detail: String(e.message || e) }))
    ]);
    let verdict = "clear_to_pay";
    const reasons = [];
    if (screen.error) { verdict = "caution"; reasons.push("invalid_address"); }
    else if (screen.status === "unavailable") { verdict = "caution"; reasons.push("sanctions_list_unavailable"); }
    else if (screen.sanctioned_match) { verdict = "do_not_pay"; reasons.push("ofac_sdn_match"); }
    if (!screen.error && dossier && !dossier.error) {
      if (dossier.flags?.includes("unused_address")) { if (verdict === "clear_to_pay") verdict = "caution"; reasons.push("payee_address_never_used"); }
    } else if (dossier?.error) reasons.push("dossier_unavailable");
    res.json({
      address: screen.address || req.params.addr,
      verdict, reasons,
      sanctions: screen, wallet: dossier,
      disclaimer: "Automated pre-flight signal from public data. Not a complete compliance program; final responsibility rests with the payer.",
      checked_at: new Date().toISOString()
    });
  } catch (e) { res.status(502).json({ error: "preflight_failed", detail: String(e.message || e) }); }
});

// ---- Paid: batch validation (up to 500 items) ----
app.post("/v1/batch/validate", (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "body.items (array) required, e.g. [{type:'iban',value:'...'}]" });
  if (items.length > 500) return res.status(400).json({ error: "max 500 items per batch" });
  const runners = { iban: validateIBAN, vat: validateVAT, bic: validateBIC, lei: validateLEI, isin: validateISIN };
  const results = items.map((it, i) => {
    const fn = runners[String(it?.type || "").toLowerCase()];
    if (!fn) return { index: i, type: it?.type ?? null, error: "unknown_type", supported: Object.keys(runners) };
    const r = fn(it.value);
    return { index: i, type: it.type, value: it.value, valid: r.valid, detail: r };
  });
  const summary = { total: items.length, valid: results.filter(r => r.valid).length, invalid: results.filter(r => r.valid === false).length, errors: results.filter(r => r.error).length };
  res.json({ summary, results });
});

// ---- Paid: on-chain data pack (direct Base reads, no third-party) ----
app.get("/v1/data/gas", async (_req, res) => { try { res.json(enrich("data/gas", await gasOracle())); } catch(e){ res.status(502).json({error:"chain_read_failed",detail:String(e.message||e)}); } });
app.get("/v1/data/block", async (_req, res) => { try { res.json(await blockInfo()); } catch(e){ res.status(502).json({error:"chain_read_failed",detail:String(e.message||e)}); } });
app.get("/v1/data/supply/:addr", async (req, res) => { try { res.json(enrich("data/supply", await tokenSupply(req.params.addr))); } catch(e){ res.status(502).json({error:"chain_read_failed",detail:String(e.message||e)}); } });
app.get("/v1/data/activity/:addr", async (req, res) => { try { res.json(enrich("data/activity", await tokenActivity(req.params.addr, Number(req.query.blocks)||2000))); } catch(e){ res.status(502).json({error:"chain_read_failed",detail:String(e.message||e)}); } });
app.get("/v1/data/portfolio/:addr", async (req, res) => { try { res.json(enrich("data/portfolio", await portfolio(req.params.addr))); } catch(e){ res.status(502).json({error:"chain_read_failed",detail:String(e.message||e)}); } });

// ---- Paid: security posture (deterministic DNS/TLS lookups) ----
app.get("/v1/security/email/:domain", async (req, res) => {
  try { res.json(enrich("security/email", await emailPosture(req.params.domain, req.query.selector))); }
  catch (e) { res.status(502).json({ error: "lookup_failed", detail: String(e.message || e) }); }
});
app.get("/v1/security/tls/:domain", async (req, res) => {
  try { res.json(enrich("security/tls", await tlsPosture(req.params.domain))); }
  catch (e) { res.status(502).json({ error: "handshake_failed", detail: String(e.message || e) }); }
});
app.get("/v1/security/typosquat/:domain", (req, res) => res.json(enrich("security/typosquat", typosquatCheck(req.params.domain, req.query.brands))));

// ---- Paid: doc utilities ----
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
app.post("/v1/doc/html-to-markdown", (req, res) => {
  const html = req.body?.html;
  if (typeof html !== "string") return res.status(400).json({ error: "body.html (string) required" });
  res.json({ markdown: turndown.turndown(html), chars_in: html.length });
});
app.post("/v1/doc/diff", (req, res) => {
  const { a, b, mode = "lines" } = req.body || {};
  if (typeof a !== "string" || typeof b !== "string")
    return res.status(400).json({ error: "body.a and body.b (strings) required" });
  const fn = mode === "words" ? Diff.diffWords : mode === "chars" ? Diff.diffChars : Diff.diffLines;
  const parts = fn(a, b).map(p => ({ value: p.value, added: !!p.added, removed: !!p.removed }));
  const changed = parts.filter(p => p.added || p.removed).length;
  res.json({ mode, changed_hunks: changed, identical: changed === 0, parts });
});

// ---- Hosted MCP endpoint: list free, calls x402-gated flat $0.005 ----
app.post("/mcp", (req, res) => {
  if (mcpGate && isPaidMcpCall(req.body)) return mcpGate(req, res, () => handleMcpRequest(req, res));
  return handleMcpRequest(req, res);
});
app.get("/mcp", (_req, res) => res.status(405).json({
  jsonrpc: "2.0", error: { code: -32000, message: "Stateless server: POST only. tools/list is free; tools/call is x402-paid ($0.005 USDC on Base)." }, id: null
}));

function openapiSpec() {
  const P = (name, desc, example) => [{ name, in: "path", required: true, description: desc, schema: { type: "string" }, example }];
  const PARAMS = {
    "/v1/token/verdict/{address}": P("address", "ERC-20 token contract address on Base (0x-prefixed, 42 chars)", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    "/v1/wallet/dossier/{address}": P("address", "Base address (EOA or contract)", "0xAe2634E709c454f2720C65A0b2F9ba168e431842"),
    "/v1/validate/iban/{iban}": P("iban", "IBAN incl. country prefix", "DE89370400440532013000"),
    "/v1/validate/vat/{vat}": P("vat", "EU VAT number incl. country prefix", "DE123456789"),
    "/v1/validate/bic/{bic}": P("bic", "BIC/SWIFT, 8 or 11 chars", "DEUTDEFF"),
    "/v1/screen/address/{addr}": P("addr", "EVM address to screen against OFAC SDN", "0xAe2634E709c454f2720C65A0b2F9ba168e431842"),
    "/v1/verify/payment/{tx}": P("tx", "Base transaction hash (0x, 66 chars)", "0x94efa7ccb96a6e906f5a8bb511b63c44cbaf98239d368ac2d428a8c176578082"),
    "/v1/verify/token/{q}": P("q", "Token address or symbol", "USDC"),
    "/v1/validate/lei/{lei}": P("lei", "20-char LEI (ISO 17442)", "5299000J2N45DDNE4Y28"),
    "/v1/validate/isin/{isin}": P("isin", "12-char ISIN (ISO 6166)", "US0378331005"),
    "/v1/preflight/{addr}": P("addr", "Payee address on Base to check before paying", "0xAe2634E709c454f2720C65A0b2F9ba168e431842"),
    "/v1/security/email/{domain}": P("domain", "Domain to check SPF/DMARC/DKIM", "example.com"),
    "/v1/security/tls/{domain}": P("domain", "Hostname to probe over TLS", "example.com"),
    "/v1/security/typosquat/{domain}": P("domain", "Domain to analyse for brand look-alikes", "c0inbase.com"),
    "/v1/data/supply/{token}": P("token", "ERC-20 contract address on Base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    "/v1/data/activity/{token}": P("token", "ERC-20 contract address on Base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    "/v1/data/portfolio/{address}": P("address", "Base address to read balances for", "0xAe2634E709c454f2720C65A0b2F9ba168e431842"),
  };
  const BODIES = {
    "/v1/doc/html-to-markdown": { required: true, content: { "application/json": { schema: { type: "object", required: ["html"], properties: { html: { type: "string", example: "<h1>Hello</h1>" } } } } } },
    "/v1/doc/diff": { required: true, content: { "application/json": { schema: { type: "object", required: ["a", "b"], properties: { a: { type: "string", example: "line one" }, b: { type: "string", example: "line two" }, mode: { type: "string", enum: ["lines", "words", "chars"] } } } } } },
    "/v1/batch/validate": { required: true, content: { "application/json": { schema: { type: "object", required: ["items"], properties: { items: { type: "array", maxItems: 500, items: { type: "object", required: ["type", "value"], properties: { type: { type: "string", enum: ["iban", "vat", "bic", "lei", "isin"] }, value: { type: "string" } } }, example: [{ type: "iban", value: "DE89370400440532013000" }] } } } } } },
  };
  return {
    openapi: "3.0.3",
    info: { title: "ChainVerdict API", version: "2.0.0", contact: { email: "contact@chainverdict.xyz" },
      description: "x402 v2 pay-per-call. Unpaid requests receive HTTP 402 with payment requirements." },
    paths: Object.fromEntries(Object.entries(PRICES).filter(([r]) => r !== "POST /mcp").map(([route, price]) => {
      const [method, path] = route.split(" ");
      const RENAME = {
        "/v1/token/verdict/*": "/v1/token/verdict/{address}", "/v1/wallet/dossier/*": "/v1/wallet/dossier/{address}",
        "/v1/validate/iban/*": "/v1/validate/iban/{iban}", "/v1/validate/vat/*": "/v1/validate/vat/{vat}",
        "/v1/validate/bic/*": "/v1/validate/bic/{bic}", "/v1/screen/address/*": "/v1/screen/address/{addr}",
        "/v1/verify/payment/*": "/v1/verify/payment/{tx}", "/v1/verify/token/*": "/v1/verify/token/{q}",
        "/v1/validate/lei/*": "/v1/validate/lei/{lei}", "/v1/validate/isin/*": "/v1/validate/isin/{isin}",
        "/v1/preflight/*": "/v1/preflight/{addr}", "/v1/security/email/*": "/v1/security/email/{domain}",
        "/v1/security/tls/*": "/v1/security/tls/{domain}", "/v1/security/typosquat/*": "/v1/security/typosquat/{domain}",
        "/v1/data/supply/*": "/v1/data/supply/{token}", "/v1/data/activity/*": "/v1/data/activity/{token}",
        "/v1/data/portfolio/*": "/v1/data/portfolio/{address}",
      };
      const oaPath = RENAME[path] || path;
      const op = {
        summary: `${path} — ${price} USDC per call via x402`,
        parameters: PARAMS[oaPath] || [],
        responses: { 200: { description: "JSON result", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, 402: { description: "Payment required (x402 v2)" } }
      };
      if (BODIES[oaPath]) op.requestBody = BODIES[oaPath];
      return [oaPath, { [method.toLowerCase()]: op }];
    }))
  };
}

const PORT = process.env.PORT || 3000;
startSanctionsRefresher();
app.listen(PORT, () => console.log(`AgentPay listening on :${PORT}`));
