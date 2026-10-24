# TradeRails

Deterministic trade & logistics primitives for commerce agents. Paid per call in USDC on Base via x402 — no keys, no signup. Every paid response is Ed25519-signed and re-verifiable offline. Pure public-spec math (GS1, ISO 6346, IMO): no upstream cost, nothing goes stale, no LLM in the serving path.

## Maintenance status

TradeRails is maintained for existing integrations. Format and check-digit
validation does not establish ownership, registration, cargo authenticity or
counterparty trust. Retirement is subject to a separate usage and migration review.

## Endpoints

- `GET /v1/gtin/validate?code=` — GTIN-8/12/13/14, UPC-A, EAN-13 ($0.004)
- `GET /v1/gtin/prefix?code=` — GS1 Member Organisation ($0.004)
- `GET /v1/sscc/validate?code=` — SSCC-18 ($0.004)
- `GET /v1/container/validate?code=` — ISO 6346 container ($0.004)
- `GET /v1/imo/validate?code=` — IMO ship number ($0.004)
- `GET /v1/gs1/decode?data=` — GS1 element string / GS1-128 ($0.006)
- `GET /v1/hs/classify?q=` — HS-code triage (default $0.05; live discovery is authoritative)

## Run

```
npm ci && npm test
npm run keygen            # prints SIGNING_KEY_PKCS8_B64
PAY_TO_ADDRESS=0x... node server.js
```

Free (unpaid) endpoints: `/`, `/health`, `/openapi.json`, `/llms.txt`, `/.well-known/x402.json`, `/.well-known/signing-key.json`.
