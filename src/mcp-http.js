// Hosted MCP endpoint (Streamable HTTP, stateless) at /mcp.
// initialize + tools/list are FREE (so registries can index us);
// every tools/call is x402-gated at a flat price by the caller in index.js.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import TurndownService from "turndown";
import * as Diff from "diff";
import { validateIBAN, validateVAT, validateBIC } from "./lib/validators.js";
import { tokenVerdict, walletDossier } from "./lib/chain.js";
import { validateLEI, validateISIN, verifyToken, verifyPayment } from "./lib/institutional.js";
import { emailPosture, tlsPosture, typosquatCheck } from "./lib/security.js";
import { gasOracle, tokenSupply, tokenActivity, blockInfo, portfolio } from "./lib/onchain-data.js";
import { enrich } from "./lib/enrich.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

// All ChainVerdict tools are read-only and idempotent: they compute verdicts or
// validations and never mutate state. openWorldHint marks tools that consult
// live external systems (Base RPC, DNS, TLS) vs pure local math.
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RO_LIVE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// Route key -> MCP tool. Descriptions interpolate the live price from PRICES so
// tools/list can never advertise a rate the payment middleware does not charge.
// Two already had drifted: $0.05 for a $0.001 route, $0.06 for a $0.01 route.
const PRICE_ROUTE = {
  token_verdict: "GET /v1/token/verdict/*", wallet_dossier: "GET /v1/wallet/dossier/*",
  validate_iban: "GET /v1/validate/iban/*", validate_vat: "GET /v1/validate/vat/*",
  validate_bic: "GET /v1/validate/bic/*", html_to_markdown: "POST /v1/doc/html-to-markdown",
  text_diff: "POST /v1/doc/diff", verify_payment: "GET /v1/verify/payment/*",
  verify_token: "GET /v1/verify/token/*", validate_lei: "GET /v1/validate/lei/*",
  validate_isin: "GET /v1/validate/isin/*", security_email: "GET /v1/security/email/*",
  security_tls: "GET /v1/security/tls/*", security_typosquat: "GET /v1/security/typosquat/*",
  data_gas: "GET /v1/data/gas", data_block: "GET /v1/data/block",
  data_token_supply: "GET /v1/data/supply/*", data_token_activity: "GET /v1/data/activity/*",
  data_portfolio: "GET /v1/data/portfolio/*",
};

function buildServer(prices = {}) {
  const server = new McpServer({ name: "chainverdict", version: "1.0.0" });
  const reg = server.registerTool.bind(server);
  server.registerTool = (name, cfg, handler) => {
    const p = prices[PRICE_ROUTE[name]];
    if (p && cfg?.description) cfg = { ...cfg, description: `${cfg.description} ${p} per call.` };
    return reg(name, cfg, handler);
  };
  server.registerTool("token_verdict", {
    title: "Token safety verdict (Base)",
    description: "Heuristic ERC-20 safety verdict on Base: bytecode risk capabilities, ownership, metadata, 0-100 score, hold/caution/avoid.",
    inputSchema: { address: z.string().describe("ERC-20 token contract address on Base (0x-prefixed, 42 chars)") },
    annotations: RO_LIVE
  }, async ({ address }) => asText(enrich("token/verdict", await tokenVerdict(address))));
  server.registerTool("wallet_dossier", {
    title: "Wallet dossier (Base)",
    description: "Profile of a Base address: EOA vs contract, balance, activity band, flags.",
    inputSchema: { address: z.string().describe("Base address to profile (0x-prefixed, 42 chars; EOA or contract)") },
    annotations: RO_LIVE
  }, async ({ address }) => asText(enrich("wallet/dossier", await walletDossier(address))));
  server.registerTool("validate_iban", {
    title: "Validate IBAN",
    description: "IBAN mod-97 checksum + country length rules.",
    inputSchema: { iban: z.string().describe("IBAN including 2-letter country prefix (e.g. DE89 3704 0044 0532 0130 00; spaces tolerated)") },
    annotations: RO
  }, async ({ iban }) => asText(enrich("iban", validateIBAN(iban))));
  server.registerTool("validate_vat", {
    title: "Validate EU VAT number",
    description: "EU VAT format validation with deterministic checksums (DE, IT, LU, PL, SI).",
    inputSchema: { vat: z.string().describe("EU VAT number including country prefix (e.g. DE123456789, LU12345678)") },
    annotations: RO
  }, async ({ vat }) => asText(enrich("vat", validateVAT(vat))));
  server.registerTool("validate_bic", {
    title: "Validate BIC/SWIFT",
    description: "BIC/SWIFT structural validation and decomposition.",
    inputSchema: { bic: z.string().describe("BIC/SWIFT code, 8 or 11 characters (e.g. DEUTDEFF or DEUTDEFF500)") },
    annotations: RO
  }, async ({ bic }) => asText(enrich("bic", validateBIC(bic))));
  server.registerTool("html_to_markdown", {
    title: "HTML to Markdown",
    description: "Convert raw HTML to clean Markdown.",
    inputSchema: { html: z.string().describe("Raw HTML string to convert (full document or fragment)") },
    annotations: RO
  }, async ({ html }) => asText({ markdown: turndown.turndown(html) }));
  server.registerTool("text_diff", {
    title: "Structured text diff",
    description: "Diff two texts (lines/words/chars).",
    inputSchema: {
      a: z.string().describe("Original text (left side of the diff)"),
      b: z.string().describe("Modified text (right side of the diff)"),
      mode: z.enum(["lines","words","chars"]).optional().describe("Diff granularity; defaults to lines")
    },
    annotations: RO
  }, async ({ a, b, mode }) => {
    const fn = mode === "words" ? Diff.diffWords : mode === "chars" ? Diff.diffChars : Diff.diffLines;
    const parts = fn(a, b).map(p => ({ value: p.value, added: !!p.added, removed: !!p.removed }));
    return asText({ mode: mode || "lines", identical: parts.every(p => !p.added && !p.removed), parts });
  });

  // ---- institutional & compliance ----
  server.registerTool("verify_payment", {
    title: "Verify on-chain payment (Base)",
    description: "Decode ERC-20 transfers in a Base transaction: amounts, counterparties, confirmations.",
    inputSchema: { txhash: z.string().describe("Base transaction hash to decode (0x-prefixed, 66 chars)") },
    annotations: RO_LIVE
  }, async ({ txhash }) => asText(enrich("verify/payment", await verifyPayment(txhash))));
  server.registerTool("verify_token", {
    title: "Canonical token check (Base)",
    description: "Is this the real USDC/EURC/WETH/cbBTC/USDT on Base? Anti-phishing for stablecoin payments.",
    inputSchema: { query: z.string().describe("Token contract address (0x…) or symbol (e.g. USDC, WETH) to verify against the canonical Base list") },
    annotations: RO
  }, async ({ query }) => asText(enrich("verify/token", verifyToken(query))));
  server.registerTool("validate_lei", {
    title: "Validate LEI (ISO 17442)",
    description: "Legal Entity Identifier checksum validation.",
    inputSchema: { lei: z.string().describe("20-character Legal Entity Identifier (ISO 17442), e.g. 5299000J2N45DDNE4Y28") },
    annotations: RO
  }, async ({ lei }) => asText(enrich("lei", validateLEI(lei))));
  server.registerTool("validate_isin", {
    title: "Validate ISIN (ISO 6166)",
    description: "Securities identifier checksum validation.",
    inputSchema: { isin: z.string().describe("12-character International Securities Identification Number (ISO 6166), e.g. US0378331005") },
    annotations: RO
  }, async ({ isin }) => asText(enrich("isin", validateISIN(isin))));

  // ---- security posture ----
  server.registerTool("security_email", {
    title: "Email spoofing posture (SPF/DMARC/DKIM)",
    description: "Live DNS check of a domain's email authentication records.",
    inputSchema: {
      domain: z.string().describe("Domain to check, without scheme (e.g. example.com)"),
      selector: z.string().optional().describe("Optional DKIM selector to look up (e.g. google, default, s1)")
    },
    annotations: RO_LIVE
  }, async ({ domain, selector }) => asText(enrich("security/email", await emailPosture(domain, selector))));
  server.registerTool("security_tls", {
    title: "TLS certificate check",
    description: "Live TLS handshake: cert validity, issuer, expiry countdown.",
    inputSchema: { domain: z.string().describe("Hostname to probe over TLS on port 443, without scheme (e.g. example.com)") },
    annotations: RO_LIVE
  }, async ({ domain }) => asText(enrich("security/tls", await tlsPosture(domain))));
  server.registerTool("security_typosquat", {
    title: "Typosquat / look-alike domain check",
    description: "Flags homoglyph and edit-distance look-alikes of known brands (c0inbase, b1nance, etc.).",
    inputSchema: {
      domain: z.string().describe("Domain to analyse for brand impersonation (e.g. c0inbase.com)"),
      brands: z.string().optional().describe("Optional comma-separated brand list to check against (defaults to a built-in set)")
    },
    annotations: RO
  }, async ({ domain, brands }) => asText(enrich("security/typosquat", typosquatCheck(domain, brands))));

  // ---- on-chain data pack (Base reads) ----
  server.registerTool("data_gas", {
    title: "Base gas oracle",
    description: "Live Base gas conditions: base fee, priority fees, congestion, est transfer cost.",
    inputSchema: {},
    annotations: RO_LIVE
  }, async () => asText(enrich("data/gas", await gasOracle())));
  server.registerTool("data_block", {
    title: "Latest Base block",
    description: "Latest block number, timestamp, tx count, gas utilization.",
    inputSchema: {},
    annotations: RO_LIVE
  }, async () => asText(await blockInfo()));
  server.registerTool("data_token_supply", {
    title: "Token supply & burn (Base)",
    description: "Total/circulating/burned supply and burn percentage for an ERC-20 on Base.",
    inputSchema: { address: z.string().describe("ERC-20 token contract address on Base (0x-prefixed, 42 chars)") },
    annotations: RO_LIVE
  }, async ({ address }) => asText(enrich("data/supply", await tokenSupply(address))));
  server.registerTool("data_token_activity", {
    title: "Token transfer activity (Base)",
    description: "Recent transfer count, volume, unique senders/receivers, activity level.",
    inputSchema: {
      address: z.string().describe("ERC-20 token contract address on Base (0x-prefixed, 42 chars)"),
      blocks: z.number().optional().describe("Look-back window in blocks (default 2000, ~1 hour on Base)")
    },
    annotations: RO_LIVE
  }, async ({ address, blocks }) => asText(enrich("data/activity", await tokenActivity(address, blocks || 2000))));
  server.registerTool("data_portfolio", {
    title: "Address portfolio (Base)",
    description: "ETH + canonical token balances (USDC/WETH/cbBTC/EURC) for an address.",
    inputSchema: { address: z.string().describe("Base address to read balances for (0x-prefixed, 42 chars)") },
    annotations: RO_LIVE
  }, async ({ address }) => asText(enrich("data/portfolio", await portfolio(address))));

  return server;
}

// Stateless: fresh server+transport per request (recommended pattern for serverless-style hosting).
export async function handleMcpRequest(req, res, prices) {
  try {
    const server = buildServer(prices);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({
      jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null
    });
  }
}

export const isPaidMcpCall = (body) => body?.method === "tools/call";
