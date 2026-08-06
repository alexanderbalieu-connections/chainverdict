import express from "express";
import TurndownService from "turndown";
import * as Diff from "diff";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { validateIBAN, validateVAT, validateBIC } from "./lib/validators.js";
import { tokenVerdict, walletDossier } from "./lib/chain.js";

const app = express();
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
  "POST /v1/doc/diff": "$0.002"
};

if (X402_ENABLED) {
  if (!PAY_TO) { console.error("PAY_TO_ADDRESS is required when X402_ENABLED"); process.exit(1); }
  const routes = Object.fromEntries(
    Object.entries(PRICES).map(([route, price]) => [route, { price, network: NETWORK }])
  );
  app.use(paymentMiddleware(PAY_TO, routes, USE_CDP ? cdpFacilitator : { url: FACILITATOR_URL }));
  console.log(`x402 enabled → payments to ${PAY_TO} on ${NETWORK} via ${USE_CDP ? "Coinbase CDP facilitator" : FACILITATOR_URL}`);
} else {
  console.log("x402 DISABLED (free mode for local testing)");
}

// ---- Free discovery endpoints (agents & humans) ----
app.get("/", (_req, res) => res.json({
  service: "ChainVerdict",
  homepage: "https://chainverdict.xyz",
  description: "Pay-per-call APIs for autonomous agents: token safety verdicts, wallet dossiers, finance validators, doc utilities. x402/USDC on Base.",
  payment: { protocol: "x402", network: NETWORK, currency: "USDC" },
  endpoints: Object.entries(PRICES).map(([route, price]) => ({ route, price })),
  openapi: "/openapi.json",
  health: "/health"
}));
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/openapi.json", (_req, res) => res.json(openapiSpec()));

// ---- Paid: on-chain verdicts ----
app.get("/v1/token/verdict/:address", async (req, res) => {
  try { res.json(await tokenVerdict(req.params.address)); }
  catch (e) { res.status(502).json({ error: "chain_read_failed", detail: String(e.message || e) }); }
});
app.get("/v1/wallet/dossier/:address", async (req, res) => {
  try { res.json(await walletDossier(req.params.address)); }
  catch (e) { res.status(502).json({ error: "chain_read_failed", detail: String(e.message || e) }); }
});

// ---- Paid: deterministic validators ----
app.get("/v1/validate/iban/:iban", (req, res) => res.json(validateIBAN(req.params.iban)));
app.get("/v1/validate/vat/:vat", (req, res) => res.json(validateVAT(req.params.vat)));
app.get("/v1/validate/bic/:bic", (req, res) => res.json(validateBIC(req.params.bic)));

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
app.listen(PORT, () => console.log(`AgentPay listening on :${PORT}`));
