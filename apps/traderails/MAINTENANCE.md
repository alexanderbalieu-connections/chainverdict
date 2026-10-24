# Maintenance guide

Entry point: `server.js`. createApp composes routes; src contains pure identifier functions.

Run `npm ci` then `npm test`. Use `.node-version` for the tested Node version.
Commit the lockfile with dependency changes. Local dependencies, environment
files, secrets and OS metadata stay outside Git and container build contexts.

JavaScript modules and new files use kebab-case; exported JS functions use
camelCase; constants use uppercase names. Existing public route names, package
names and evidence filenames are compatibility interfaces: do not rename them
for cosmetic consistency. Python references retain their existing snake_case.

## Payment evidence

The settlement-evidence module records SDK-confirmed successful EVM settlement
hashes correlated with fixed route templates and response finish/abort status.
It uses AsyncLocalStorage; tests exercise the actual SDK with a fake facilitator.
A transaction hash is payer-resolvable on-chain. It logs no payer address, raw URL, query, body, credential, signature or campaign data.
A finished HTTP response does not prove useful delivery or a human customer.
MCP attribution on the main service is POST /mcp, not an individual tool.

Records go only to existing private service logs. Retention and availability
follow the existing host settings; this is not a durable sales ledger. Old wallet
transfers cannot be retroactively attributed by matching an amount. Owner-only
analysis may deduplicate by network + transaction hash + route. Never publish
these logs or introduce a public telemetry endpoint. No paid self-test is enabled.

## Deliberate duplication

Small HEAD/payment-evidence helpers are vendored across independent deployments,
with matching tests, to avoid a new package/service dependency. Changes must be
copied deliberately and the source hashes compared in the owner audit. Public
Inspector bundles and evidence ZIPs are generated distribution artifacts, not
redundant source. Dated proofs and backups are preservation records.

## Release

Run relevant tests and syntax/import checks. Review the exact diff. Preserve
Pulse archive backup/restore evidence before a Pulse deployment. Verify running
commit, keys, payment protections and collector health afterward. Keep prices,
wallets and purchase-loop settings unchanged unless separately authorised.

## Owner payment attribution (18 October 2026)

Exact SDK settlement events remain in private stdout for recovery. Main and
TradeRails also expose an internal authenticated bounded memory buffer; Pulse
pulls these every five minutes and appends/fsyncs a private journal on its
existing persistent disk. Buffers reset on restart and can overflow: events
between a pull and a restart may be lost. The journal is not a complete ledger.
A timestamped HMAC using a per-host HKDF-derived key from the existing shared facilitator secret
authenticates the fixed read-only relay; the credential itself is never sent.
This shares the existing cross-service trust boundary, not independent source
isolation. Relay and owner routes are absent from public discovery. Pulse owner
reads use a distinct HKDF-derived read-only owner token via Authorization, never query strings. The old short alert-test token is not accepted. HTTP email-test triggers are disabled.
Never expose the private journal in static files, archive exports or backups.
Owner-local exports retain experiment records through the 31 October review;
no automated deletion is introduced. Revisit retention with the owner then.

The public payout page uses a dated one-time Basescan import plus persistent
incremental watcher deposits, not a block scan. Render cannot fetch Basescan
(403); no hosted scraper is attempted. Snapshot and live scan times stay visible.
Absent data and stale scans never become a claim of zero transfers. Exact transaction/network joins
annotate routes; repeated transfers or conflicting route records remain under
review. A completed response proves neither useful delivery nor a new customer.
The retired test wallet remains in the self-address filter; retain its key until
the owner has recovered funds, never delete a key protecting remaining assets.
