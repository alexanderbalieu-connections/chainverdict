import express from "express";
import TurndownService from "turndown";
import * as Diff from "diff";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { validateIBAN, validateVAT, validateBIC } from "./lib/validators.js";
import { tokenVerdict, walletDossier } from "./lib/chain.js";
import { handleMcpRequest, isPaidMcpCall } from "./mcp-http.js";
import { validateLEI, validateISIN, verifyToken, verifyPayment } from "./lib/institutional.js";
import { screenAddress, startSanctionsRefresher } from "./lib/sanctions.js";
import { signResponses, signingInfo } from "./lib/signing.js";
import { emailPosture, tlsPosture, typosquatCheck } from "./lib/security.js";
import { gasOracle, tokenSupply, tokenActivity, blockInfo, portfolio } from "./lib/onchain-data.js";
import { enrich } from "./lib/enrich.js";
import { evidenceMiddleware, methodologyDocument, METHODOLOGY_VERSION, noteBlockHeight } from "./evidence.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const LANDING = readFileSync(join(__dir, "landing.html"), "utf8");

const app = express();

app.set('trust proxy', true); // Render terminates TLS at its proxy; without this req.protocol is 'http' and CDP rejects the bazaar declaration
let mcpGate = null;
app.use(signResponses("/v1/"));
app.use(express.json({ limit: "2mb" }));
// Evidence layer: annotates /v1/* responses with checks, sources, freshness,
// confidence and limitations. Registered after signResponses so the Ed25519
// signature covers the evidence block too.
app.use(evidenceMiddleware());

const PAY_TO = process.env.PAY_TO_ADDRESS;            // your Base wallet (public address only)
const RAW_NET = process.env.X402_NETWORK || "base";
const NETWORK = RAW_NET === "base" ? "eip155:8453" : RAW_NET === "base-sepolia" ? "eip155:84532" : RAW_NET; // CAIP-2 (x402 v2)
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const USE_CDP = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
const X402_ENABLED = process.env.X402_ENABLED !== "false";

// ---- Pricing (USDC) — tune freely, redeploys in seconds ----
// NOTE: x402 middleware matches "*" wildcards (not ":param").
const PRICES = {
  "GET /v1/token/verdict/*": "$0.01",
  "GET /v1/wallet/dossier/*": "$0.01",
  "GET /v1/validate/iban/*": "$0.001",
  "GET /v1/validate/vat/*": "$0.001",
  "GET /v1/validate/bic/*": "$0.001",
  "POST /v1/doc/html-to-markdown": "$0.002",
  "POST /v1/doc/diff": "$0.002",
  "POST /mcp": "$0.005",
  // Sanctions screening is a commodity: ~15 services in the ecosystem sell an OFAC
  // lookup, the cheapest at $0.002 with three lists to our one. We cannot win on
  // coverage without a week's work, so we win on price and stop pretending it is a
  // differentiator. $0.001 is the floor tier and half the cheapest competitor.
  // NOT free: a free route leaves the paid-routes map and therefore leaves the
  // Bazaar catalog, and the stale $0.05 entry already published cannot be removed.
  "GET /v1/screen/address/*": "$0.001",
  "GET /v1/verify/payment/*": "$0.02",
  "GET /v1/verify/token/*": "$0.005",
  "GET /v1/validate/lei/*": "$0.002",
  "GET /v1/validate/isin/*": "$0.001",
  "GET /v1/preflight/*": "$0.01",
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


// ---- Bazaar discovery metadata -------------------------------------------------
// The CDP facilitator only catalogs a route if it declares extensions.bazaar.
// Each entry gives the real path-parameter name, a working example value, and the
// output shape so an agent can call the endpoint correctly without guessing.
const BAZAAR_ROUTES = {
  "GET /v1/token/verdict/*":     { p: "address", ex: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", d: "ERC-20 token contract address on Base", out: { verdict: "hold", score: 84 } },
  "GET /v1/wallet/dossier/*":    { p: "address", ex: "0xAe2634E709c454f2720C65A0b2F9ba168e431842", d: "Base address (EOA or contract)", out: { type: "EOA", flags: [] } },
  "GET /v1/validate/iban/*":     { p: "iban",    ex: "DE89370400440532013000", d: "IBAN incl. country prefix", out: { valid: true } },
  "GET /v1/validate/vat/*":      { p: "vat",     ex: "DE123456789", d: "EU VAT number incl. country prefix", out: { valid: true } },
  "GET /v1/validate/bic/*":      { p: "bic",     ex: "DEUTDEFF", d: "BIC/SWIFT code, 8 or 11 chars", out: { valid: true } },
  "GET /v1/screen/address/*":    { p: "addr",    ex: "0xAe2634E709c454f2720C65A0b2F9ba168e431842", d: "EVM address to screen against the OFAC SDN list", out: { sanctioned_match: false } },
  "GET /v1/verify/payment/*":    { p: "tx",      ex: "0x94efa7ccb96a6e906f5a8bb511b63c44cbaf98239d368ac2d428a8c176578082", d: "Base transaction hash", out: { confirmations: 12 } },
  "GET /v1/verify/token/*":      { p: "q",       ex: "USDC", d: "Token contract address or symbol", out: { canonical: true } },
  "GET /v1/validate/lei/*":      { p: "lei",     ex: "5299000J2N45DDNE4Y28", d: "20-character LEI (ISO 17442)", out: { valid: true } },
  "GET /v1/validate/isin/*":     { p: "isin",    ex: "US0378331005", d: "12-character ISIN (ISO 6166)", out: { valid: true } },
  "GET /v1/preflight/*":         { p: "addr",    ex: "0xAe2634E709c454f2720C65A0b2F9ba168e431842", d: "Payee address to check before sending funds", out: { verdict: "clear_to_pay" } },
  "GET /v1/security/email/*":    { p: "domain",  ex: "example.com", d: "Domain to check SPF/DMARC/DKIM", out: { spf: true } },
  "GET /v1/security/tls/*":      { p: "domain",  ex: "example.com", d: "Hostname to probe over TLS", out: { valid: true } },
  "GET /v1/security/typosquat/*":{ p: "domain",  ex: "c0inbase.com", d: "Domain to analyse for brand impersonation", out: { suspicious: true } },
  "GET /v1/data/supply/*":       { p: "addr",    ex: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", d: "ERC-20 contract address on Base", out: { total: "1000000" } },
  "GET /v1/data/activity/*":     { p: "addr",    ex: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", d: "ERC-20 contract address on Base", out: { transfers: 42 } },
  "GET /v1/data/portfolio/*":    { p: "addr",    ex: "0xAe2634E709c454f2720C65A0b2F9ba168e431842", d: "Base address to read balances for", out: { eth: "0.5" } },
  "GET /v1/data/gas":            { out: { baseFeeGwei: 0.004 } },
  "GET /v1/data/block":          { out: { blockNumber: 41234567 } },
  "POST /v1/doc/html-to-markdown": { body: { html: "<h1>Hello</h1>" }, out: { markdown: "# Hello" } },
  "POST /v1/doc/diff":           { body: { a: "line one", b: "line two" }, out: { identical: false } },
  "POST /v1/batch/validate":     { body: { items: [{ type: "iban", value: "DE89370400440532013000" }] }, out: { results: [] } },
};

// ---- Bazaar route descriptions -------------------------------------------------
// This is the text an agent reads in the Bazaar catalog when deciding whether to
// call an endpoint, so it states what the check actually does, what it returns,
// and — where it matters — what it does NOT establish. Kept separate from the
// `d` fields above, which describe the path PARAMETER, not the route.
const ROUTE_DESCRIPTIONS = {
  "GET /v1/preflight/*":
    "The check to run immediately before an agent sends USDC to an address it did not hard-code. Composite of OFAC SDN screening and on-chain address profiling, returned as clear_to_pay / caution / do_not_pay with the evidence behind it. 'clear_to_pay' means no configured negative signal fired — it is not an endorsement or a guarantee of counterparty legitimacy.",
  "GET /v1/screen/address/*":
    "Screen an EVM address against the US OFAC SDN digital-currency address list at $0.001 — the cheapest sanctions lookup in the ecosystem, Ed25519-signed so you can verify it offline. Exact-list-match, refreshed daily. Screens that one list only — not EU, UN or UK/OFSI — and a non-match is not evidence the counterparty is legitimate. Not a regulated AML/KYT service and does not discharge any legal screening obligation.",
  "GET /v1/token/verdict/*":
    "Safety verdict for an ERC-20 on Base: ownership and mint authority, proxy upgradeability, liquidity and holder concentration, transfer-restriction patterns. Returns hold/caution/avoid with a score and the signals behind it. Heuristic static analysis, not a security audit — a proxy contract can change its implementation after this check.",
  "GET /v1/wallet/dossier/*":
    "Profile of a Base address before you transact with it: EOA or contract, first and last seen, transaction and counterparty counts, contract-verification status, and any flags raised. Behavioural signals only — they describe activity, not intent.",
  "GET /v1/verify/payment/*":
    "Verify a Base transaction actually did what a counterparty says it did: confirmation depth, success or revert, value, token, sender and recipient. Use it to confirm an inbound payment before releasing goods or data.",
  "GET /v1/verify/token/*":
    "Resolve a token symbol or contract address to the canonical Base contract, so an agent swapping or accepting 'USDC' gets the real one. Catches lookalike and impostor contracts sharing a symbol.",
  "GET /v1/validate/iban/*":
    "Validate an IBAN structurally: country length rules, character set and the ISO 7064 mod-97 check. Deterministic. A structurally valid IBAN is not proof the account exists, is open, or belongs to the party you are paying.",
  "GET /v1/validate/vat/*":
    "Validate an EU VAT number's structure and per-country check digits. Format only — no VIES lookup, so it does not confirm the registration is active or belongs to the named trader.",
  "GET /v1/validate/bic/*":
    "Validate a BIC/SWIFT code against ISO 9362: 8 or 11 characters, bank and country segments, location and branch codes. Structural only; does not confirm the institution is reachable.",
  "GET /v1/validate/lei/*":
    "Validate a Legal Entity Identifier against ISO 17442: 20 characters, allowed character set and mod-97 check digits. Structural only — no GLEIF registry lookup, so it does not confirm the LEI is issued or active.",
  "GET /v1/validate/isin/*":
    "Validate an ISIN against ISO 6166: country prefix, 9-character NSIN and Luhn check digit. Structural only; does not confirm the instrument exists or is tradeable.",
  "POST /v1/batch/validate":
    "Validate up to 500 identifiers in a single call — IBAN, VAT, BIC, LEI and ISIN mixed freely. One payment instead of 500, for reconciliation and onboarding runs. Same structural scope as the individual validators.",
  "GET /v1/security/email/*":
    "Email-authentication posture for a domain: SPF record and policy, DMARC policy and alignment, DKIM selector presence. Use it to judge whether mail claiming to be from a counterparty can be trusted. Live DNS.",
  "GET /v1/security/tls/*":
    "Live TLS probe of a hostname: certificate validity and expiry, issuer, chain completeness, protocol and cipher. Confirms an endpoint you are about to send data to is actually serving a valid certificate right now.",
  "GET /v1/security/typosquat/*":
    "Analyse a domain for brand impersonation: homoglyph substitution, character insertion and omission, TLD swaps and known-brand proximity. Returns a suspicion verdict with the specific patterns matched. Heuristic — a match is a reason to check, not proof of intent.",
  "POST /v1/doc/html-to-markdown":
    "Convert an HTML document to clean Markdown for LLM ingestion: strips scripts, styles and navigation chrome, preserves headings, lists, tables and links. Deterministic for identical input.",
  "POST /v1/doc/diff":
    "Structured diff of two text blocks: per-line additions, deletions and changes, plus an identical flag. Use it to detect whether a contract, policy or spec changed between two fetches.",
  "GET /v1/data/portfolio/*":
    "Native ETH and ERC-20 token balances for a Base address in one call, read live from chain at a stated block height.",
  "GET /v1/data/activity/*":
    "Recent transfer activity for an ERC-20 on Base: transfer count and volume over the sampled window, for judging whether a token is actually in use. Live chain read.",
  "GET /v1/data/supply/*":
    "Total and circulating supply for an ERC-20 on Base, read live from chain with decimals applied and the block height returned.",
  "GET /v1/data/gas":
    "Current Base gas conditions: base fee and priority fee in gwei, at a stated block height. For agents deciding whether to transact now or wait.",
  "GET /v1/data/block":
    "Latest Base block: number, timestamp and hash. The cheapest call on the service — useful as a liveness and connectivity check.",
};
function bazaarRouteKey(route) {
  const meta = BAZAAR_ROUTES[route];
  return meta?.p ? route.replace(/\/\*$/, `/:${meta.p}`) : route;
}

function bazaarExtensionFor(route) {
  const meta = BAZAAR_ROUTES[route];
  if (!meta) return undefined;
  try {
    if (meta.body) {
      return declareDiscoveryExtension({
        bodyType: "json",
        input: meta.body,
        output: { example: meta.out, schema: { type: "object", additionalProperties: true } },
      });
    }
    if (meta.p) {
      return declareDiscoveryExtension({
        pathParams: { [meta.p]: meta.ex },
        pathParamsSchema: { type: "object", properties: { [meta.p]: { type: "string", description: meta.d } }, required: [meta.p] },
        output: { example: meta.out, schema: { type: "object", additionalProperties: true } },
      });
    }
    return declareDiscoveryExtension({
      output: { example: meta.out, schema: { type: "object", additionalProperties: true } },
    });
  } catch (e) {
    console.error(`bazaar declaration failed for ${route}:`, e.message);
    return undefined;
  }
}

if (X402_ENABLED) {
  if (!PAY_TO) { console.error("PAY_TO_ADDRESS is required when X402_ENABLED"); process.exit(1); }
  const facilitatorClient = USE_CDP
    ? new HTTPFacilitatorClient(createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET))
    : new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());
  const routes = Object.fromEntries(
    Object.entries(PRICES).filter(([r]) => r !== "POST /mcp")
      .map(([route, price]) => {
        const cfg = { accepts: { scheme: "exact", price, network: NETWORK, payTo: PAY_TO }, mimeType: "application/json" };
        const ext = bazaarExtensionFor(route);
        if (ext) cfg.extensions = ext;
        const desc = ROUTE_DESCRIPTIONS[route] || BAZAAR_ROUTES[route]?.d;
        cfg.description = ROUTE_DESCRIPTIONS[route] || (desc ? `${route} - ${desc}` : route);
        return [bazaarRouteKey(route), cfg];
      })
  );
  const declared = Object.values(routes).filter(r => r.extensions?.bazaar).length;
  console.log(`bazaar discovery declared on ${declared}/${Object.keys(routes).length} routes`);
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
  description: "Evidence-backed checks an autonomous agent can run before it moves money or trusts a counterparty: sanctions screening, payee risk, token safety, payment verification, financial-identifier validation and web-security posture. Every answer states what was checked, when, how confident it is and what it does not mean.",
  payment: { protocol: "x402", network: NETWORK, currency: "USDC" },
  endpoints: Object.entries(PRICES).map(([route, price]) => ({ route, price })),
  openapi: "/openapi.json",
  llms: "/llms.txt",
  methodology: "/v1/methodology",
  methodologyVersion: METHODOLOGY_VERSION,
  attestation: "https://pulse.chainverdict.xyz/v1/attestations/latest?url=https://chainverdict.xyz/v1/data/block",
  x402_discovery: "/.well-known/x402.json",
  health: "/health"
  });
});
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), methodologyVersion: METHODOLOGY_VERSION }));
// Public methodology: what each endpoint checks, its sources, freshness model,
// confidence basis and limitations. Free by design — buyers should be able to
// audit how a verdict is produced before paying for one.
app.get("/v1/methodology", (_req, res) => res.json(methodologyDocument()));
app.get("/openapi.json", (_req, res) => res.json(openapiSpec()));
// CORS: the verifier page at reg.chainverdict.xyz/verify fetches published keys
// from every service. A public signing key is public by definition — without
// this header the browser blocks the fetch and receipts from this service
// silently appear unverifiable.
app.get("/.well-known/signing-key.json", (_req, res) => {
  res.set("access-control-allow-origin", "*");
  res.json(signingInfo());
});
// One portfolio manifest, maintained in a single place rather than copied here.
app.get("/.well-known/portfolio.json", (_req, res) =>
  res.redirect(302, "https://pulse.chainverdict.xyz/.well-known/portfolio.json"));

app.get("/llms.txt", (_req, res) => res.type("text/plain").send(
`# ChainVerdict
> Evidence-backed checks an autonomous agent runs BEFORE it moves money or trusts a counterparty.
> Screen a payee for sanctions, profile a recipient address, verify a token is canonical, confirm a payment settled,
> validate an IBAN/VAT/BIC/LEI/ISIN, or check a domain's email/TLS posture — in one call, with no account.
>
> Every paid response carries a machine-readable _evidence object: checksPerformed, dataSources, freshness
> (with explicit stale-data risk), confidence, limitations, and whether human approval is recommended.
> Responses are Ed25519-signed so you can verify offline that the answer is genuinely ChainVerdict's.
> Methodology is public and free to read: https://chainverdict.xyz/v1/methodology
>
> Honest scope: these are informational signals for decision support. They are NOT regulated financial, legal or
> compliance advice, and the absence of a negative signal is never a guarantee of safety.
>
> Billing is per call in USDC on Base (x402) — no API keys, no signup, no subscription.

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
- Methodology (free): https://chainverdict.xyz/v1/methodology
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
      description: "Evidence-backed checks for autonomous agents before moving money or trusting a counterparty. Every paid response includes an _evidence object (checks performed, data sources, freshness, confidence, limitations, recommended action) and is Ed25519-signed. Methodology: /v1/methodology. Informational signals only - not regulated financial, legal or compliance advice. Billing is per call in USDC on Base (x402); unpaid requests receive HTTP 402 with payment requirements." },
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
        parameters: PARAMS[oaPath] || [{ name: "format", in: "query", required: false, description: "Response format (json)", schema: { type: "string", enum: ["json"], default: "json" }, example: "json" }],
        responses: { 200: { description: "JSON result", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, 402: { description: "Payment required (x402 v2)" } }
      };
      if (BODIES[oaPath]) op.requestBody = BODIES[oaPath];
      return [oaPath, { [method.toLowerCase()]: op }];
    }))
  };
}

app.get("/favicon.ico", (_req, res) => res.sendFile(join(__dir, "favicon.ico")));

const PORT = process.env.PORT || 3000;
startSanctionsRefresher();
app.listen(PORT, () => console.log(`AgentPay listening on :${PORT}`));
