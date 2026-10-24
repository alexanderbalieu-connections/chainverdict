# Hosting and repository map

The main API and website live at the repository root. TradeRails is maintained in `apps/traderails`, imported from its original owned repository with a Git subtree. Pulse remains in the separate `x402pulse` repository and on its existing persistent-disk service.

All three products remain available. This is a hosting consolidation, not a product retirement. Existing route URLs, prices and signing identities are retained.

## Run the two APIs

Install both locked dependency trees with `npm ci` and `npm ci --prefix apps/traderails`. Use `npm run start:portfolio` or the production Dockerfile. `npm start` continues to run the original main API alone for local development.

The shared host retains its existing main-service environment. Add `TRADERAILS_LEGACY_CONFIG` containing the allowlisted existing TradeRails environment as a JSON object. Never commit, print or include those values in command-line arguments. Both signing keys must remain pinned and distinct.

The gateway listens on `PORT`, forwarding only recognized Host values to two loopback child processes. Bodies and signing/payment headers are streamed unchanged, with no automatic request retries. Each child receives only its own application configuration. This prevents accidental configuration collisions; it is not an operating-system security boundary.

Use `/_portfolio/health` as the Render readiness path. It fails while either worker is starting or restarting. Each worker has a separate heap limit and capped exponential restart backoff. Existing Pulse monitoring checks both public signing-key endpoints, so an unavailable worker is visible to the portfolio checks.

## Validate and release

1. Run both suites and the Docker capacity experiment. The experiment uses generated test keys, mock settlements, a hard 512 MiB / 0.5 CPU limit, and no outside network. Synthetic transactions are not customer or revenue evidence.
2. Preserve the old service's exact environment, signing key and pending settlement evidence. Confirm the new worker serves the same public key before moving its domain.
3. Move only `trade.chainverdict.xyz` to the retained main service and verify its TLS certificate, discovery, route gates, signatures and the Pulse relay pull.
4. Reversibly suspend the redundant TradeRails service only after the canonical domain works. Do not delete the old service or keys. Its Render-provided alias cannot move with the custom domain and is no longer the supported public address.
5. For rollback, resume the old service and restore the custom domain and DNS. Pulse's archive, signing identity, private payment journal and disk never move.
