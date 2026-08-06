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
import { screenAddress } from "./lib/sanctions.js";
import { emailPosture, tlsPosture, typosquatCheck } from "./lib/security.js";
import { gasOracle, tokenSupply, tokenActivity, blockInfo, portfolio } from "./lib/onchain-data.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

function buildServer() {
  const server = new McpServer({ name: "chainverdict", version: "1.0.0" });
  server.registerTool("token_verdict", {
    title: "Token safety verdict (Base)",
    description: "Heuristic ERC-20 safety verdict on Base: bytecode risk capabilities, ownership, metadata, 0-100 score, hold/caution/avoid.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => asText(await tokenVerdict(address)));
  server.registerTool("wallet_dossier", {
    title: "Wallet dossier (Base)",
    description: "Profile of a Base address: EOA vs contract, balance, activity band, flags.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => asText(await walletDossier(address)));
  server.registerTool("validate_iban", {
    title: "Validate IBAN",
    description: "IBAN mod-97 checksum + country length rules.",
    inputSchema: { iban: z.string() }
  }, async ({ iban }) => asText(validateIBAN(iban)));
  server.registerTool("validate_vat", {
    title: "Validate EU VAT number",
    description: "EU VAT format validation with deterministic checksums (DE, IT, LU, PL, SI).",
    inputSchema: { vat: z.string() }
  }, async ({ vat }) => asText(validateVAT(vat)));
  server.registerTool("validate_bic", {
    title: "Validate BIC/SWIFT",
    description: "BIC/SWIFT structural validation and decomposition.",
    inputSchema: { bic: z.string() }
  }, async ({ bic }) => asText(validateBIC(bic)));
  server.registerTool("html_to_markdown", {
    title: "HTML to Markdown",
    description: "Convert raw HTML to clean Markdown.",
    inputSchema: { html: z.string() }
  }, async ({ html }) => asText({ markdown: turndown.turndown(html) }));
  server.registerTool("text_diff", {
    title: "Structured text diff",
    description: "Diff two texts (lines/words/chars).",
    inputSchema: { a: z.string(), b: z.string(), mode: z.enum(["lines","words","chars"]).optional() }
  }, async ({ a, b, mode }) => {
    const fn = mode === "words" ? Diff.diffWords : mode === "chars" ? Diff.diffChars : Diff.diffLines;
    const parts = fn(a, b).map(p => ({ value: p.value, added: !!p.added, removed: !!p.removed }));
    return asText({ mode: mode || "lines", identical: parts.every(p => !p.added && !p.removed), parts });
  });

  // ---- institutional & compliance ----
  server.registerTool("screen_address_ofac", {
    title: "OFAC sanctions screening",
    description: "Screen a crypto address against the OFAC SDN digital-currency list (daily-refreshed). Pre-flight check before paying anyone. $0.05.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => asText(screenAddress(address)));
  server.registerTool("preflight_payee", {
    title: "Pre-payment trust check",
    description: "One-call payee safety: OFAC screening + wallet profile + clear_to_pay/caution/do_not_pay verdict. $0.06.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => {
    const screen = screenAddress(address);
    const dossier = await walletDossier(address).catch(e => ({ error: String(e.message || e) }));
    let verdict = "clear_to_pay"; const reasons = [];
    if (screen.error) { verdict = "caution"; reasons.push("invalid_address"); }
    else if (screen.sanctioned_match) { verdict = "do_not_pay"; reasons.push("ofac_sdn_match"); }
    else if (screen.status === "unavailable") { verdict = "caution"; reasons.push("sanctions_list_unavailable"); }
    if (dossier?.flags?.includes("unused_address") && verdict === "clear_to_pay") { verdict = "caution"; reasons.push("payee_address_never_used"); }
    return asText({ address: screen.address || address, verdict, reasons, sanctions: screen, wallet: dossier });
  });
  server.registerTool("verify_payment", {
    title: "Verify on-chain payment (Base)",
    description: "Decode ERC-20 transfers in a Base transaction: amounts, counterparties, confirmations. $0.02.",
    inputSchema: { txhash: z.string() }
  }, async ({ txhash }) => asText(await verifyPayment(txhash)));
  server.registerTool("verify_token", {
    title: "Canonical token check (Base)",
    description: "Is this the real USDC/EURC/WETH/cbBTC/USDT on Base? Anti-phishing for stablecoin payments. $0.005.",
    inputSchema: { query: z.string().describe("token address or symbol") }
  }, async ({ query }) => asText(verifyToken(query)));
  server.registerTool("validate_lei", {
    title: "Validate LEI (ISO 17442)",
    description: "Legal Entity Identifier checksum validation. $0.002.",
    inputSchema: { lei: z.string() }
  }, async ({ lei }) => asText(validateLEI(lei)));
  server.registerTool("validate_isin", {
    title: "Validate ISIN (ISO 6166)",
    description: "Securities identifier checksum validation. $0.001.",
    inputSchema: { isin: z.string() }
  }, async ({ isin }) => asText(validateISIN(isin)));

  // ---- security posture ----
  server.registerTool("security_email", {
    title: "Email spoofing posture (SPF/DMARC/DKIM)",
    description: "Live DNS check of a domain's email authentication records. $0.01.",
    inputSchema: { domain: z.string(), selector: z.string().optional() }
  }, async ({ domain, selector }) => asText(await emailPosture(domain, selector)));
  server.registerTool("security_tls", {
    title: "TLS certificate check",
    description: "Live TLS handshake: cert validity, issuer, expiry countdown. $0.01.",
    inputSchema: { domain: z.string() }
  }, async ({ domain }) => asText(await tlsPosture(domain)));
  server.registerTool("security_typosquat", {
    title: "Typosquat / look-alike domain check",
    description: "Flags homoglyph and edit-distance look-alikes of known brands (c0inbase, b1nance, etc.). $0.005.",
    inputSchema: { domain: z.string(), brands: z.string().optional().describe("comma-separated brand list") }
  }, async ({ domain, brands }) => asText(typosquatCheck(domain, brands)));

  // ---- on-chain data pack (Base reads) ----
  server.registerTool("data_gas", {
    title: "Base gas oracle",
    description: "Live Base gas conditions: base fee, priority fees, congestion, est transfer cost. $0.002.",
    inputSchema: {}
  }, async () => asText(await gasOracle()));
  server.registerTool("data_block", {
    title: "Latest Base block",
    description: "Latest block number, timestamp, tx count, gas utilization. $0.001.",
    inputSchema: {}
  }, async () => asText(await blockInfo()));
  server.registerTool("data_token_supply", {
    title: "Token supply & burn (Base)",
    description: "Total/circulating/burned supply and burn percentage for an ERC-20 on Base. $0.003.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => asText(await tokenSupply(address)));
  server.registerTool("data_token_activity", {
    title: "Token transfer activity (Base)",
    description: "Recent transfer count, volume, unique senders/receivers, activity level. $0.005.",
    inputSchema: { address: z.string(), blocks: z.number().optional() }
  }, async ({ address, blocks }) => asText(await tokenActivity(address, blocks || 2000)));
  server.registerTool("data_portfolio", {
    title: "Address portfolio (Base)",
    description: "ETH + canonical token balances (USDC/WETH/cbBTC/EURC) for an address. $0.004.",
    inputSchema: { address: z.string() }
  }, async ({ address }) => asText(await portfolio(address)));

  return server;
}

// Stateless: fresh server+transport per request (recommended pattern for serverless-style hosting).
export async function handleMcpRequest(req, res) {
  try {
    const server = buildServer();
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
