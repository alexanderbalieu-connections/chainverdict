# ChainVerdict — chainverdict.xyz

Checks an autonomous agent runs **before it moves money or trusts a counterparty**:
token safety verdicts and wallet risk profiles on Base, on-chain payment
verification, financial-identifier validation, and live domain security posture.

Every call is paid per request in USDC on Base over the **x402** protocol —
no accounts, no API keys, no signup. Every response carries an evidence record
saying what was checked, how fresh it is and what it does **not** establish, and
is Ed25519-signed. **No LLM inference anywhere:** every answer is a deterministic
computation or a live read of external state, so the same input returns the same
answer forever.

## MCP server

ChainVerdict is a remote **MCP (Model Context Protocol) server**, built on the
official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
and served over **Streamable HTTP** at:

```
https://chainverdict.xyz/mcp
```

It is published in the official MCP registry as `xyz.chainverdict/chainverdict`.

- **`initialize` and `tools/list` are free**, so registries and clients can index
  the server without paying.
- **`tools/call` is x402-paid** at the price of the route behind the tool — except
  `payment_info`, which is free.
- 20 MCP **tools**, all read-only and idempotent, annotated with
  `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- No MCP **resources** or **prompts** are exposed; this server is tools-only.

Tool descriptions interpolate the live price from the same map the payment
middleware charges from, so `tools/list` can never advertise a rate that is not
the rate. `test/mcp-parity.test.js` fails the build if a tool exists for a route
that is no longer sold, or if a sold route has no tool.

### Tools

| Tool | What it answers |
|---|---|
| `payment_info` | **Free.** How x402 payment works, the price of every tool, where payments settle. |
| `token_verdict` | Is this ERC-20 on Base a scam, a honeypot, or safe to hold? |
| `wallet_dossier` | Wallet risk profile for a Base address before you pay it. |
| `verify_payment` | Decode and confirm an on-chain payment on Base. |
| `verify_token` | Resolve a symbol or address to the canonical Base token. |
| `validate_iban` `validate_vat` `validate_bic` `validate_lei` `validate_isin` | Deterministic check-digit and format validation. |
| `security_email` `security_tls` `security_typosquat` | SPF/DMARC/DKIM posture, live TLS probe, brand look-alike analysis. |
| `data_gas` `data_block` `data_token_supply` `data_token_activity` `data_portfolio` | Live Base chain reads. |
| `html_to_markdown` `text_diff` | Document utilities. |

`POST /v1/batch/validate` is HTTP-only by design: 500 identifiers do not belong
in a tool-call argument.

## HTTP rate card

Every endpoint answers an unpaid request with a 402 quote.

| Route | Price |
|---|---|
| `GET /v1/token/verdict/*` | $0.01 |
| `GET /v1/wallet/dossier/*` | $0.01 |
| `GET /v1/validate/iban/*` | $0.001 |
| `GET /v1/validate/vat/*` | $0.001 |
| `GET /v1/validate/bic/*` | $0.001 |
| `POST /v1/doc/html-to-markdown` | $0.002 |
| `POST /v1/doc/diff` | $0.002 |
| `GET /v1/verify/payment/*` | $0.02 |
| `GET /v1/verify/token/*` | $0.005 |
| `GET /v1/validate/lei/*` | $0.002 |
| `GET /v1/validate/isin/*` | $0.001 |
| `POST /v1/batch/validate` | $0.10 |
| `GET /v1/security/email/*` | $0.01 |
| `GET /v1/security/tls/*` | $0.01 |
| `GET /v1/security/typosquat/*` | $0.005 |
| `GET /v1/data/gas` | $0.002 |
| `GET /v1/data/block` | $0.001 |
| `GET /v1/data/supply/*` | $0.003 |
| `GET /v1/data/activity/*` | $0.005 |
| `GET /v1/data/portfolio/*` | $0.004 |

Free to read before you pay for anything: `/` (discovery), `/health`,
`/openapi.json`, `/llms.txt`, `/v1/methodology`, `/.well-known/x402.json`.

The whole portfolio, machine-readable:
<https://pulse.chainverdict.xyz/.well-known/portfolio.json>

## Local dev

```bash
npm ci
X402_ENABLED=false npm start   # free mode, no payments
npm test                       # 34 tests
```

## Ops

Stateless. No database, no cron, no maintained data set. Sources are pure
arithmetic over public specifications plus live Base RPC.

## Limitations

These are informational signals. **None is a compliance control**, none discharges
a legal obligation, and none is regulated financial, legal or compliance advice.
A valid signature proves a response came from this service unaltered — not that
the answer is correct. A signed wrong answer is still wrong, and still signed.

Operated by Alexander Balieu, independent professional established in Luxembourg.

## Licence

MIT. See [LICENSE](./LICENSE).
