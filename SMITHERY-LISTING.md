Replacement text for the Smithery listing (smithery.ai/servers/alexander-balieu/chainverdict).

The listing as of 1 September 2026 was built from the 11 August deployment and
advertised 21 tools including "OFAC sanctions screening $0.05" and "Pre-payment
trust check $0.06". Both were withdrawn on 27 August. Redeploy from current main
so the tool list is regenerated, then replace the description with the text below.

--- paste from here ---

Pay-per-call checks an AI agent runs before it moves money or trusts a
counterparty. No API keys, no accounts, no signup. Each paid tool call settles in
USDC on Base via the x402 protocol directly from the agent's wallet
($0.001-$0.10 per call), through the Coinbase CDP facilitator, in about two
seconds. Call the free payment_info tool first: it explains how payment works and
lists every price.

20 tools in five groups:

- Free - payment_info: how to pay, what each tool costs, where payments settle.
- On-chain safety - token safety verdicts (is this ERC-20 a scam or safe to
  hold), wallet risk profiles, payment and token verification on Base.
- Finance validators - IBAN, VAT, BIC/SWIFT, LEI, ISIN: deterministic
  check-digit and format validation with enrichment.
- Web security - TLS certificate checks, SPF/DMARC/DKIM email-spoofing posture,
  brand typosquat and homoglyph detection.
- Base chain data - live gas oracle, block info, token supply, token activity,
  address portfolio.

Every response carries an evidence record stating what was checked, against which
sources, how fresh it is, and what the answer does not establish, and is
Ed25519-signed (verify at https://pulse.chainverdict.xyz/verify). No LLM
inference anywhere: every response is a deterministic computation or a live read
of external state, so the same input returns the same answer forever.

These are informational signals. None of them is a compliance control, none
discharges a legal obligation, and a valid signature proves that a response came
from this service unaltered - not that the answer is correct.

Methodology: https://chainverdict.xyz/v1/methodology
Full portfolio and price list: https://pulse.chainverdict.xyz/.well-known/portfolio.json

--- to here ---

If the redeploy cannot be made to work quickly, delete the server instead. A
listing that offers two withdrawn services in your name is worse than no listing,
and the official MCP registry entry (server.json in this repo) replaces it.
