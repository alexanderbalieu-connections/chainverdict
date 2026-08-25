// ChainVerdict evidence layer.
//
// Every paid response carries a machine-readable `_evidence` object stating
// WHAT was checked, WHEN, from WHICH source, HOW confident the result is, and —
// critically — WHAT THE RESULT DOES NOT MEAN. A verdict that sounds certain
// ("clear_to_pay") is dangerous without its limitations attached; a stale
// "clean" sanctions result is worse than no result at all.
//
// Design constraint: this layer must never be able to break a response. Every
// annotation path is wrapped so that any internal error falls through to the
// original, unmodified body.

export const METHODOLOGY_VERSION = "cv-2.1.0";

// ---- freshness bases -------------------------------------------------------
// deterministic  : pure math over the input; no external state; never stale.
// live-chain     : read from Base at request time; valid for ~1 block (~2s).
// live-dns/tls   : network observation at request time; point-in-time only.
// daily-refresh  : sourced from a list refreshed on a schedule (OFAC SDN).
// curated        : maintained by ChainVerdict; changes rarely, by hand.

const DETERMINISTIC_LIMITS = [
  "Validates structure and check digits only. A structurally valid identifier is NOT proof that the account, entity or instrument exists, is active, or belongs to the party you are transacting with.",
];

const R = (o) => o; // readability helper

// Ordered: first matching prefix wins.
const REGISTRY = [
  R({
    match: "/v1/screen/address",
    subject: "crypto address",
    decision: "sanctions_screen",
    checks: ["OFAC SDN digital-currency address list match (exact, case-insensitive)"],
    sources: [{ name: "US Treasury OFAC SDN list (digital currency addresses)", refresh: "daily" }],
    freshness: { basis: "daily-refresh", maxUsefulAgeSeconds: 86400 },
    assurance: { level: "exact-list-match", basis: "exact string match against a published list; high precision, bounded recall (a list can be incomplete or out of date)" },
    humanApprovalRecommended: "on_match",
    limitations: [
      "Screens the US OFAC SDN digital-currency address list ONLY. It does NOT screen EU, UN, UK/OFSI, or any other sanctions regime.",
      "A non-match means the address is absent from that one list at the last refresh. It is NOT evidence that the counterparty is legitimate, unsanctioned elsewhere, or safe to pay.",
      "Newly designated addresses appear only after the next refresh. Screening is not real-time.",
      "This is an informational screening signal, not a regulated AML/KYT/sanctions-compliance service, and does not discharge any legal screening obligation.",
    ],
  }),
  R({
    match: "/v1/preflight",
    subject: "payee address",
    decision: "payee_risk",
    checks: [
      "OFAC SDN digital-currency address list match",
      "On-chain address profile (EOA vs contract, balance, activity band)",
      "Composite heuristic verdict: clear_to_pay / caution / do_not_pay",
    ],
    sources: [
      { name: "US Treasury OFAC SDN list (digital currency addresses)", refresh: "daily" },
      { name: "Base mainnet RPC", refresh: "per-request" },
    ],
    freshness: { basis: "daily-refresh+live-chain", maxUsefulAgeSeconds: 60 },
    assurance: { level: "heuristic", basis: "composite of one exact list match and heuristic address signals; the heuristic component is not validated against a labelled dataset" },
    humanApprovalRecommended: "unless_clear_to_pay",
    limitations: [
      "'clear_to_pay' means no configured negative signal was found. It is NOT an endorsement, a guarantee of counterparty legitimacy, or a recommendation to transact.",
      "Sanctions coverage is the US OFAC SDN digital-currency list only; other regimes are not screened.",
      "Address heuristics detect patterns (unused address, contract vs EOA), not intent. A fresh address is common in legitimate use.",
      "Cannot detect off-chain fraud, social engineering, address substitution in your own pipeline, or a counterparty who is legitimate today and not tomorrow.",
      "Informational risk signal only; not regulated financial, legal, or compliance advice.",
    ],
  }),
  R({
    match: "/v1/token/verdict",
    subject: "ERC-20 contract",
    decision: "token_risk",
    checks: [
      "Bytecode capability scan (risk-bearing functions)",
      "Ownership / privileged-role presence",
      "Token metadata consistency",
      "Composite 0-100 score → hold / caution / avoid",
    ],
    sources: [{ name: "Base mainnet RPC (contract bytecode + metadata)", refresh: "per-request" }],
    freshness: { basis: "live-chain", maxUsefulAgeSeconds: 60 },
    assurance: { level: "heuristic", basis: "heuristic static analysis; no execution, no audit, no liquidity or market analysis; not validated against a labelled dataset" },
    humanApprovalRecommended: "unless_hold",
    limitations: [
      "Heuristic static analysis — NOT a security audit and not a substitute for one.",
      "A proxy contract can change its implementation after this check; the result describes the contract as observed at the stated block only.",
      "Does not analyse liquidity, holder distribution, market manipulation, wash trading, or off-chain claims about the project.",
      "'hold' is the absence of detected red flags, not a judgement that the token is a sound holding. Nothing here is investment advice.",
    ],
  }),
  R({
    match: "/v1/wallet/dossier",
    subject: "Base address",
    decision: "address_profile",
    checks: ["EOA vs contract detection", "Native balance", "Activity band", "Heuristic flags"],
    sources: [{ name: "Base mainnet RPC", refresh: "per-request" }],
    freshness: { basis: "live-chain", maxUsefulAgeSeconds: 60 },
    assurance: { level: "observed-with-heuristics", basis: "balances and code presence are direct chain reads; behavioural flags are heuristic" },
    humanApprovalRecommended: "no",
    limitations: [
      "Describes on-chain state at the stated block. It does not identify the owner of the address.",
      "Flags are behavioural heuristics, not accusations. 'unused_address' is common in legitimate first-time payments.",
    ],
  }),
  R({
    match: "/v1/verify/payment",
    subject: "transaction hash",
    decision: "payment_verification",
    checks: ["Transaction receipt lookup", "ERC-20 Transfer log decoding", "Counterparties and amounts", "Confirmation depth"],
    sources: [{ name: "Base mainnet RPC", refresh: "per-request" }],
    freshness: { basis: "live-chain", maxUsefulAgeSeconds: 30 },
    assurance: { level: "observed", basis: "direct receipt and log decoding; deterministic given the chain state at the stated block" },
    humanApprovalRecommended: "no",
    limitations: [
      "Reports what the chain records. Low confirmation counts remain theoretically reorg-exposed; check the confirmations field before treating a payment as final.",
      "Does not verify that the payment settles any particular off-chain obligation.",
    ],
  }),
  R({
    match: "/v1/verify/token",
    subject: "token address or symbol",
    decision: "canonical_token_check",
    checks: ["Match against ChainVerdict's curated canonical Base token list (USDC, EURC, WETH, cbBTC, USDT)"],
    sources: [{ name: "ChainVerdict curated canonical token list", refresh: "manual" }],
    freshness: { basis: "curated", maxUsefulAgeSeconds: null },
    assurance: { level: "exact-list-match", basis: "exact match against a small hand-maintained allowlist; the list is not exhaustive" },
    humanApprovalRecommended: "on_mismatch",
    limitations: [
      "Covers a small curated set of major Base tokens. 'Not canonical' means 'not on this list' — it is not a claim that the token is fraudulent.",
      "The list is maintained manually and may lag new canonical deployments.",
    ],
  }),
  R({
    match: "/v1/security/email",
    subject: "domain",
    decision: "email_spoofing_posture",
    checks: ["SPF record lookup", "DMARC policy lookup", "DKIM selector lookup (when supplied)"],
    sources: [{ name: "Live public DNS", refresh: "per-request" }],
    freshness: { basis: "live-dns", maxUsefulAgeSeconds: 3600 },
    assurance: { level: "observed", basis: "direct DNS observation at request time; subject to resolver caching" },
    humanApprovalRecommended: "no",
    limitations: [
      "Describes published DNS policy, not whether a specific message was authentic.",
      "DNS caching means a very recent record change may not yet be visible.",
      "Absence of DKIM at the probed selector does not prove DKIM is unconfigured; selectors are arbitrary.",
    ],
  }),
  R({
    match: "/v1/security/tls",
    subject: "hostname",
    decision: "tls_posture",
    checks: ["TLS handshake", "Certificate validity window", "Issuer", "Expiry countdown"],
    sources: [{ name: "Live TLS handshake, port 443", refresh: "per-request" }],
    freshness: { basis: "live-tls", maxUsefulAgeSeconds: 3600 },
    assurance: { level: "observed", basis: "direct observation of the certificate presented to this server at this moment" },
    humanApprovalRecommended: "no",
    limitations: [
      "Observes the certificate presented to this server at this moment; a different client, SNI or geography may be served a different certificate.",
      "A valid certificate proves control of the hostname, not the honesty of its operator.",
    ],
  }),
  R({
    match: "/v1/security/typosquat",
    subject: "domain",
    decision: "brand_impersonation_signal",
    checks: ["Homoglyph substitution detection", "Edit-distance comparison against a brand list"],
    sources: [{ name: "ChainVerdict curated brand list + string analysis", refresh: "manual" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "heuristic", basis: "string-similarity heuristic; brand list is not exhaustive; not validated against a labelled dataset" },
    humanApprovalRecommended: "on_match",
    limitations: [
      "Similarity to a brand is a signal, not proof of malicious intent; legitimate domains can resemble brands.",
      "The brand list is finite — a non-match does not mean the domain is not impersonating something.",
      "Does not inspect site content, registration data, or reputation.",
    ],
  }),
  R({
    match: "/v1/data/",
    subject: "chain object",
    decision: "chain_data",
    checks: ["Direct Base mainnet read"],
    sources: [{ name: "Base mainnet RPC", refresh: "per-request" }],
    freshness: { basis: "live-chain", maxUsefulAgeSeconds: 30 },
    assurance: { level: "observed", basis: "direct chain read at the stated block" },
    humanApprovalRecommended: "no",
    limitations: [
      "Point-in-time chain state. Values change every block (~2s on Base); treat as immediately perishable.",
    ],
  }),
  R({
    match: "/v1/validate/iban",
    subject: "IBAN",
    decision: "identifier_validation",
    checks: ["ISO 13616 structure", "Country-specific length rule", "MOD-97-10 check digits"],
    sources: [{ name: "ISO 13616 / ECBS country register (bundled rules)", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic", basis: "the checksum arithmetic is certain; this says nothing about real-world existence or status" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS.concat([
      "Does not confirm the account is open, the holder's identity, or that the bank will accept a transfer.",
    ]),
  }),
  R({
    match: "/v1/validate/vat",
    subject: "EU VAT number",
    decision: "identifier_validation",
    checks: ["Country prefix and format", "Deterministic checksum where defined (DE, IT, LU, PL, SI)"],
    sources: [{ name: "Published national VAT checksum rules (bundled)", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic-partial", basis: "checksum arithmetic is certain where implemented; format-only for other member states" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS.concat([
      "Checksums are implemented for a subset of member states; others are format-checked only.",
      "This is NOT a VIES registration check. It does not confirm the number is currently registered or valid for intra-EU supply.",
    ]),
  }),
  R({
    match: "/v1/validate/bic",
    subject: "BIC/SWIFT",
    decision: "identifier_validation",
    checks: ["ISO 9362 structure", "Component decomposition (institution, country, location, branch)"],
    sources: [{ name: "ISO 9362 structural rules (bundled)", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "structural", basis: "structure is certain; BIC carries no check digit and no registry lookup is performed" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS.concat([
      "BIC has no check digit. Structural validity does not confirm the code is assigned to an operating institution — that requires the SWIFT registry.",
    ]),
  }),
  R({
    match: "/v1/validate/lei",
    subject: "LEI",
    decision: "identifier_validation",
    checks: ["ISO 17442 format", "MOD-97-10 check digits"],
    sources: [{ name: "ISO 17442 (bundled)", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic", basis: "the checksum arithmetic is certain; this says nothing about real-world existence or status" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS.concat([
      "Does not query GLEIF. It cannot tell you the entity name or whether the LEI registration is Issued, Lapsed or Retired.",
    ]),
  }),
  R({
    match: "/v1/validate/isin",
    subject: "ISIN",
    decision: "identifier_validation",
    checks: ["ISO 6166 format", "Luhn check digit"],
    sources: [{ name: "ISO 6166 (bundled)", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic", basis: "the checksum arithmetic is certain; this says nothing about real-world existence or status" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS.concat([
      "Does not confirm the security exists, is listed, or is tradeable. No reference-data lookup is performed.",
    ]),
  }),
  R({
    match: "/v1/batch/validate",
    subject: "identifier batch",
    decision: "identifier_validation",
    checks: ["Per-item structural and checksum validation (iban, vat, bic, lei, isin)"],
    sources: [{ name: "Bundled standards rules", refresh: "with releases" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic", basis: "per-item checksum arithmetic is certain; see each item type's limitations" },
    humanApprovalRecommended: "no",
    limitations: DETERMINISTIC_LIMITS,
  }),
  R({
    match: "/v1/doc/",
    subject: "document",
    decision: "transformation",
    checks: ["Deterministic text transformation"],
    sources: [{ name: "Request payload only", refresh: "n/a" }],
    freshness: { basis: "deterministic", maxUsefulAgeSeconds: null },
    assurance: { level: "deterministic", basis: "deterministic transformation of the supplied input" },
    humanApprovalRecommended: "no",
    limitations: ["Operates only on the text you supplied. No external data is consulted and no claim is made about its accuracy."],
  }),
];

const GLOBAL_LIMITS = [
  "ChainVerdict returns informational signals for automated decision support. It is not regulated financial, legal, tax or compliance advice, and it does not discharge any legal or regulatory obligation you may have.",
  "No result should be treated as a guarantee. Absence of a negative signal is not a positive assurance.",
];

export function lookupEvidence(path) {
  return REGISTRY.find((e) => path.startsWith(e.match)) || null;
}

export function methodologyDocument(prices = {}) {
  return {
    service: "ChainVerdict",
    methodologyVersion: METHODOLOGY_VERSION,
    published: new Date().toISOString(),
    principle:
      "Every paid response states what was checked, when, from which source, how the answer was produced, and what it does not mean. Signals are designed to be verifiable by the buyer rather than trusted on assertion.",
    evidenceModel: {
      assurance:
        "assurance.level is an ordinal label describing HOW an answer was produced (deterministic / structural / observed / exact-list-match / heuristic). It is deliberately NOT a numeric score, because a number implies calibration that ChainVerdict has not performed. No level should be read as a probability that a subject is safe, legitimate or correct.",
      calibration:
        "ChainVerdict does NOT currently publish precision, recall or calibration metrics for its heuristic checks, and does not claim they are calibrated. Heuristic levels are labelled as such precisely so that a buyer does not mistake them for validated statistical estimates.",
      integrityVsTruth:
        "Signing proves provenance and integrity: this response came from ChainVerdict and was not altered. It does not prove the conclusion is correct. A signed wrong answer is still wrong, and is still signed.",
      freshness:
        "freshness.basis states how the answer ages. 'deterministic' never goes stale. 'live-chain', 'live-dns' and 'live-tls' are point-in-time observations. 'daily-refresh' depends on an upstream list and carries a stale-data risk that is stated explicitly.",
      limitations:
        "Every response carries the specific limitations of that check plus service-wide limitations. These are part of the product, not a disclaimer footer.",
      signature:
        "Responses carry an Ed25519 signature in an x-signature header, computed over canonical JSON (keys sorted recursively, UTF-8) concatenated with '|' and the x-signed-at timestamp. The public key is published as base64 SPKI at /.well-known/signing-key.json, which states the exact verification recipe. This is NOT the compact-JWS form used by TradeRails and x402pulse, so the browser verifier at https://pulse.chainverdict.xyz/verify cannot currently check ChainVerdict receipts — verify these programmatically instead. See integrityVsTruth above for what a valid signature does not establish.",
    },
    globalLimitations: GLOBAL_LIMITS,
    endpoints: REGISTRY.map((e) => ({
      pathPrefix: e.match,
      decision: e.decision,
      subject: e.subject,
      checksPerformed: e.checks,
      dataSources: e.sources,
      freshness: e.freshness,
      assurance: e.assurance,
      humanApprovalRecommended: e.humanApprovalRecommended,
      limitations: e.limitations,
      priceUsd: prices[e.match] ?? undefined,
    })),
    corrections:
      "Errors, false positives and false negatives can be reported to contact@chainverdict.xyz. Material methodology changes increment methodologyVersion and are reflected in this document.",
  };
}

// Best-effort cached Base block height. Never blocks or fails a request.
let blockCache = { height: null, at: 0, status: "unknown" };
export function noteBlockHeight(height) {
  if (Number.isFinite(Number(height))) {
    blockCache = { height: Number(height), at: Date.now(), status: "observed" };
  }
}
function blockContext(basis) {
  if (!basis || !String(basis).includes("chain")) return undefined;
  if (blockCache.height == null) return { blockHeight: null, blockHeightStatus: "not_observed_this_process" };
  return {
    blockHeight: blockCache.height,
    blockHeightObservedAt: new Date(blockCache.at).toISOString(),
    blockHeightAgeSeconds: Math.round((Date.now() - blockCache.at) / 1000),
  };
}

// Pull a source-refresh timestamp out of a payload if the upstream provided one.
const REFRESH_KEYS = ["list_updated", "listUpdated", "source_updated", "sourceUpdated", "as_of", "asOf", "updated", "last_refresh", "lastRefresh"];
function sourceRefreshFrom(body) {
  for (const k of REFRESH_KEYS) {
    if (body && body[k] != null) return String(body[k]);
  }
  return null;
}

export function buildEvidence(path, body) {
  const spec = lookupEvidence(path);
  if (!spec) return null;
  const now = new Date();
  const srcRefresh = sourceRefreshFrom(body);
  const freshness = {
    basis: spec.freshness.basis,
    observedAt: now.toISOString(),
    maxUsefulAgeSeconds: spec.freshness.maxUsefulAgeSeconds,
    ...(spec.freshness.basis.includes("daily")
      ? {
          sourceLastRefreshed: srcRefresh,
          staleDataRisk:
            "This answer depends on a list refreshed on a schedule. A designation made since the last refresh will not appear here. Re-check before acting on a high-value decision.",
        }
      : {}),
    ...(spec.freshness.maxUsefulAgeSeconds
      ? { guidance: `Do not cache or reuse this result beyond ${spec.freshness.maxUsefulAgeSeconds}s; re-request instead.` }
      : { guidance: "Deterministic result: stable for identical input." }),
  };
  return {
    methodologyVersion: METHODOLOGY_VERSION,
    decision: spec.decision,
    semantics: {
      assuranceIsNotAProbability:
        "assurance.level is an ORDINAL description of how the answer was produced. It is NOT a calibrated probability. 'deterministic' does not mean '100% chance this counterparty is safe'; it means the arithmetic of the check is certain. No number here should be read as a likelihood of safety, legitimacy or correctness.",
      signatureProvesIntegrityNotTruth:
        "The Ed25519 signature proves that ChainVerdict produced this exact response and that it was not altered in transit. It does NOT prove the conclusion is correct. Integrity is not truth.",
      absenceOfSignalIsNotAssurance:
        "A negative finding means the specific checks listed in checksPerformed did not fire. It is not evidence that the subject is safe, legitimate or fit for your purpose.",
    },
    subject: spec.subject,
    checksPerformed: spec.checks,
    dataSources: spec.sources,
    freshness,
    ...(blockContext(spec.freshness.basis) || {}),
    assurance: spec.assurance,
    humanApprovalRecommended: spec.humanApprovalRecommended,
    limitations: spec.limitations,
    globalLimitations: GLOBAL_LIMITS,
    methodology: "https://chainverdict.xyz/v1/methodology",
    verifySignature: "https://chainverdict.xyz/.well-known/signing-key.json",
  };
}

/**
 * Express middleware. Annotates successful JSON responses on /v1/* with
 * `_evidence`. Wrapped so that a failure here can never break the response.
 */
export function evidenceMiddleware() {
  return function evidenceLayer(req, res, next) {
    const original = res.json.bind(res);
    res.json = (body) => {
      try {
        const status = res.statusCode || 200;
        const annotatable =
          status >= 200 && status < 300 &&
          req.path.startsWith("/v1/") &&
          body && typeof body === "object" && !Array.isArray(body) &&
          !body._evidence && !body.error;
        if (annotatable) {
          // opportunistically learn the block height from chain payloads
          const h = body.blockNumber ?? body.block ?? body.block_number ?? body.height;
          if (h != null) noteBlockHeight(typeof h === "object" ? h?.number : h);
          const ev = buildEvidence(req.path, body);
          if (ev) return original({ ...body, _evidence: ev });
        }
      } catch {
        /* never break a response because of the evidence layer */
      }
      return original(body);
    };
    next();
  };
}
