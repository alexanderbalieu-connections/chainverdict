# Maintenance guide

Entry point: `src/index.js`. Main HTTP app; src/mcp-http.js maps the paid MCP tools.

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
