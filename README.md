# ChainVerdict — chainverdict.xyz

Pay-per-call APIs for autonomous AI agents. Payments via **x402** (USDC on Base) — no accounts, no API keys, agents pay per request straight to your wallet.

## Endpoints
| Route | Price | What it does |
|---|---|---|
| `GET /v1/token/verdict/{address}` | $0.02 | Token safety verdict on Base (bytecode risk flags, ownership, metadata → hold/caution/avoid score) |
| `GET /v1/wallet/dossier/{address}` | $0.01 | Wallet profile: type, balance, activity band, risk flags |
| `GET /v1/validate/iban/{iban}` | $0.001 | IBAN mod-97 checksum + country length rules |
| `GET /v1/validate/vat/{vat}` | $0.001 | EU VAT format + deterministic checksums (DE, IT, LU, PL, SI) |
| `GET /v1/validate/bic/{bic}` | $0.001 | BIC/SWIFT structure validation + decomposition |
| `POST /v1/doc/html-to-markdown` | $0.002 | Clean HTML → Markdown |
| `POST /v1/doc/diff` | $0.002 | Structured diff (lines/words/chars) |

Free: `/` (discovery), `/health`, `/openapi.json`.

## Deploy (one time, ~15 min)
1. Push this repo to GitHub.
2. Render.com → New → Blueprint → select repo (`render.yaml` does the rest).
3. Set env vars in Render: `PAY_TO_ADDRESS` (your Base wallet), `RPC_URL` (free Alchemy Base endpoint).
4. Point your domain at the Render URL (CNAME).
5. **Test with fake money first:** set `X402_NETWORK=base-sepolia`, pay yourself from a testnet wallet, confirm flow. Then flip to `base`.
6. List it: submit to the x402 Bazaar / Agent.market discovery index so agents can find you.

## Local dev
```bash
npm ci
X402_ENABLED=false npm start   # free mode
npm test                        # 16 validator tests
```

## Ops
Stateless, no database, no cron. Data sources: pure math + live Base RPC. Nothing to maintain.
