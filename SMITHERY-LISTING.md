Replacement text for the Smithery listing description
(smithery.ai/servers/alexander-balieu/chainverdict -> Settings -> Description).

Why: the description as of 1 September 2026 advertised "21 tools" including
"OFAC SDN screening" and "one-call pre-payment trust checks", and its example
prompts led with "run a preflight trust check". Both services were withdrawn on
27 August. The Releases redeploy fixes the TOOL LIST (20 tools, confirmed); the
description is a separate stored field and has to be replaced by hand.

Click into the Description box, select all, delete, paste everything between the
two markers below.

--- paste from here ---

Pay-per-call checks an AI agent runs before it moves money or trusts a counterparty. No API keys, no accounts, no signup. Each paid tool call settles in USDC on Base via the x402 protocol, straight from the agent's wallet ($0.001-$0.10 per call), through the Coinbase CDP facilitator, in about two seconds.

**Start with the free `payment_info` tool.** It costs nothing, explains how payment works, and lists the price of every other tool. A client without wallet support can still call it.

**20 tools in five groups:**

- **Free** - `payment_info`: how to pay, what each tool costs, where payments settle.
- **On-chain safety** - token safety verdicts (is this ERC-20 a scam, a honeypot, or safe to hold), wallet risk profiles, on-chain payment verification, canonical token checks on Base.
- **Finance validators** - IBAN, VAT, BIC/SWIFT, LEI, ISIN: deterministic check-digit and format validation with enrichment.
- **Web security** - TLS certificate checks, SPF/DMARC/DKIM email-spoofing posture, brand typosquat and homoglyph detection.
- **Base chain data** - live gas oracle, block info, token supply, token activity, address portfolio.

Every response carries an evidence record - what was checked, against which sources, how fresh it is, and what the answer does **not** establish - and is Ed25519-signed. **No LLM inference anywhere:** every response is a deterministic computation or a live read of external state, so the same input returns the same answer forever.

These are informational signals. None is a compliance control, none discharges a legal obligation, and a valid signature proves a response came from this service unaltered - not that the answer is correct.

**Docs:** [llms.txt](https://chainverdict.xyz/llms.txt) - [OpenAPI](https://chainverdict.xyz/openapi.json) - [Methodology](https://chainverdict.xyz/v1/methodology) - [Verify a response](https://pulse.chainverdict.xyz/verify) - [Full portfolio and price list](https://pulse.chainverdict.xyz/.well-known/portfolio.json) - [Website](https://chainverdict.xyz)

**Example prompts:**
- "What does this cost? Call payment_info."
- "Get a token safety verdict for 0x... on Base."
- "Profile the wallet 0x... before I pay it."
- "Validate this IBAN and this VAT number."
- "Is example.com's email spoofable? Check SPF/DMARC."

--- to here ---
