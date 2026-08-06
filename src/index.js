import express from "express";
import TurndownService from "turndown";
import * as Diff from "diff";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
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
const NETWORK = process.env.X402_NETWORK || "base";   // "base" (mainnet) or "base-sepolia" (test)
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
  const routes = Object.fromEntries(
    Object.entries(PRICES).filter(([r]) => r !== "POST /mcp")
      .map(([route, price]) => [route, { price, network: NETWORK }])
  );
  app.use(paymentMiddleware(PAY_TO, routes, USE_CDP ? cdpFacilitator : { url: FACILITATOR_URL }));
  mcpGate = paymentMiddleware(PAY_TO, { "POST /mcp": { price: PRICES["POST /mcp"], network: NETWORK } },
    USE_CDP ? cdpFacilitator : { url: FACILITATOR_URL });
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
`));
app.get("/.well-known/x402.json", (_req, res) => res.json({
  x402Version: 1,
  name: "ChainVerdict",
  description: "Pay-per-call verdict APIs for autonomous agents on Base.",
  url: "https://chainverdict.xyz",
  network: NETWORK,
  currency: "USDC",
  payTo: PAY_TO || null,
  resources: Object.entries(PRICES).map(([route, price]) => {
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
  return {
    openapi: "3.0.3",
    info: { title: "ChainVerdict API", version: "1.0.0",
      description: "x402 pay-per-call. Unpaid requests receive HTTP 402 with payment requirements." },
    paths: Object.fromEntries(Object.entries(PRICES).map(([route, price]) => {
      const [method, path] = route.split(" ");
      return [path.replace(/:(\w+)/g, "{$1}"), {
        [method.toLowerCase()]: {
          summary: `${path} — ${price} USDC per call via x402`,
          responses: { 200: { description: "JSON result" }, 402: { description: "Payment required (x402)" } }
        }
      }];
    }))
  };
}

const PORT = process.env.PORT || 3000;
startSanctionsRefresher();
app.listen(PORT, () => console.log(`AgentPay listening on :${PORT}`));
