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
