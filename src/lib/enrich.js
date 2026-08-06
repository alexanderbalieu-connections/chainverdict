// Enrichment layer — adds deterministic, truthful value-add fields on top of each
// tool's base response. Never removes or alters existing fields, so basic callers are
// unaffected. Every added field is computed from data already present — no guessing,
// no external calls, no fabricated scores. Enrichments live under `enrichment`.

// ---- reference data (public, stable) ----
const IBAN_BANK_SLICE = { // where the bank identifier sits in the BBAN, per country
  DE:[0,8], FR:[0,5], ES:[0,4], IT:[1,6], NL:[0,4], BE:[0,3], AT:[0,5],
  LU:[0,3], PT:[0,4], IE:[0,4], GB:[0,4], CH:[0,5], PL:[0,8], FI:[0,6]
};
const COUNTRY_NAMES = {
  DE:"Germany",FR:"France",ES:"Spain",IT:"Italy",NL:"Netherlands",BE:"Belgium",
  AT:"Austria",LU:"Luxembourg",PT:"Portugal",IE:"Ireland",GB:"United Kingdom",
  CH:"Switzerland",PL:"Poland",FI:"Finland",SE:"Sweden",DK:"Denmark",NO:"Norway",
  GR:"Greece",EL:"Greece",CZ:"Czechia",SK:"Slovakia",SI:"Slovenia",HR:"Croatia",
  HU:"Hungary",RO:"Romania",BG:"Bulgaria",LT:"Lithuania",LV:"Latvia",EE:"Estonia",
  MT:"Malta",CY:"Cyprus"
};
const SEPA = new Set(["AT","BE","BG","CH","CY","CZ","DE","DK","EE","ES","FI","FR","GB","GR","HR","HU","IE","IS","IT","LI","LT","LU","LV","MC","MT","NL","NO","PL","PT","RO","SE","SI","SK","SM","VA"]);
const EU = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

// ---- per-tool enrichers. key = base route stem, value = fn(baseResponse) -> enrichment obj ----
const enrichers = {
  iban(r) {
    if (!r.valid || !r.bban) return null;
    const cc = r.country;
    const e = { country_name: COUNTRY_NAMES[cc] || null, sepa_member: SEPA.has(cc), currency_zone: EU.has(cc) ? "likely EUR (EU)" : "national" };
    const sl = IBAN_BANK_SLICE[cc];
    if (sl) { e.bank_identifier = r.bban.slice(sl[0], sl[1]); e.bank_identifier_note = "Parsed positionally from BBAN; maps to a bank via national directory (not bundled)."; }
    return e;
  },
  vat(r) {
    if (!r.country) return null;
    const cc = r.country === "EL" ? "GR" : r.country;
    return { country_name: COUNTRY_NAMES[cc] || null, eu_member: EU.has(cc),
      cross_border_note: r.valid ? "Format valid — for live VIES active-status confirmation, a stateful lookup is still required." : undefined };
  },
  bic(r) {
    if (!r.valid || !r.parts) return null;
    return { country_name: COUNTRY_NAMES[r.parts.country] || null,
      connectivity: r.parts.branch === "XXX" ? "primary office" : "specific branch",
      environment: r.checks?.test_bic ? "TEST bic (position 8 = '0') — not for live settlement" : "live" };
  },
  lei(r) {
    if (!r.valid) return null;
    return { lou_prefix: r.parts?.lou_prefix || null,
      usage: "Required for OTC derivatives & securities reporting under EMIR / MiFID II / Dodd-Frank.",
      renewal_note: "LEIs require annual renewal; a valid checksum does not confirm the registration is currently active (GLEIF lookup needed)." };
  },
  isin(r) {
    if (!r.valid || !r.parts) return null;
    return { country_or_agency: COUNTRY_NAMES[r.parts.country] || (r.parts.country === "XS" ? "International (Euroclear/Clearstream)" : r.parts.country),
      instrument_scope: "ISIN identifies the security globally; it does not encode the trading venue (see MIC/CFI for that)." };
  },
  "token/verdict"(r) {
    if (!r.capabilities) return null;
    const caps = r.capabilities;
    const explain = [];
    if (caps.mint) explain.push("mint: owner can create new tokens → supply inflation risk");
    if (caps.pause) explain.push("pause: transfers can be frozen by owner");
    if (caps.blacklist) explain.push("blacklist: specific addresses can be blocked");
    if (caps.proxy) explain.push("proxy: contract logic is upgradeable → behaviour can change");
    return {
      capability_explanations: explain.length ? explain : ["No high-risk owner capabilities detected in bytecode."],
      next_checks: ["Confirm liquidity depth & lock", "Check holder concentration", "Verify source on Basescan"],
      confidence_basis: "Bytecode selector + state heuristics only. Not a security audit; absence of flags ≠ safe."
    };
  },
  "wallet/dossier"(r) {
    if (r.error) return null;
    return { interpretation:
        r.type === "contract" ? "Contract address — treat as a program, not a person."
        : r.activity_band === "none" ? "Never-used address — verify it's the intended recipient before paying."
        : r.activity_band === "high" ? "High activity — possibly an exchange, bridge, or bot."
        : "Standard externally-owned account." };
  },
  "screen/address"(r) {
    if (r.sanctioned_match === undefined) return null;
    return { action_recommendation: r.sanctioned_match ? "DO NOT transact — address matches OFAC SDN list." : "No OFAC SDN match found — proceed per your own compliance policy.",
      audit_fields: { list_source: r.list, list_size: r.list_size, list_loaded_at: r.list_loaded_at, screened_at: new Date().toISOString() },
      compliance_note: "Screens the public OFAC SDN crypto-address list only. Not a full sanctions/AML program; no fuzzy entity match." };
  },
  "verify/payment"(r) {
    if (!r.found) return null;
    const canon = (r.erc20_transfers || []).filter(t => t.canonical_token);
    return { settlement_status: r.status === "success" ? (r.confirmations >= 1 ? "confirmed" : "pending confirmation") : "reverted/failed",
      finality: r.confirmations >= 5 ? "final" : r.confirmations >= 1 ? "soft-confirmed" : "unconfirmed",
      canonical_stablecoin_transfers: canon.length,
      largest_transfer: (r.erc20_transfers || []).reduce((m, t) => (parseFloat(t.amount) > parseFloat(m?.amount || "0") ? t : m), null) };
  },
  "verify/token"(r) {
    if (r.canonical === undefined) return null;
    return { recommendation: r.canonical ? `Confirmed canonical ${r.symbol} on Base — safe to reference in payment flows.` : "NOT a canonical token — high phishing risk. Do not treat as the real asset without independent verification.",
      issuer: r.issuer || null };
  },
  "security/email"(r) {
    if (!r.posture) return null;
    const rec = [];
    if (!r.checks?.spf?.present) rec.push("Add an SPF record to authorize sending IPs.");
    if (!r.checks?.dmarc?.present) rec.push("Add a DMARC record to define spoofing policy.");
    else if (!r.checks?.dmarc?.enforced) rec.push("Strengthen DMARC to p=quarantine or p=reject.");
    return { spoofability: r.posture === "protected" ? "hard to spoof" : r.posture === "partial" ? "partially protected" : "easily spoofable",
      recommendations: rec.length ? rec : ["Email authentication is well-configured."] };
  },
  "security/tls"(r) {
    if (r.posture === undefined) return null;
    const d = r.days_to_expiry;
    return { urgency: d == null ? "unknown" : d < 0 ? "EXPIRED — do not trust" : d < 7 ? "critical (<7 days)" : d < 30 ? "renew soon (<30 days)" : "healthy",
      trust_summary: r.tls_authorized ? "Certificate chain valid at query time." : "Certificate NOT trusted: " + (r.authorization_error || "unknown reason") };
  },
  "security/typosquat"(r) {
    if (r.suspicious === undefined) return null;
    return { risk_level: !r.suspicious ? "clean" : r.findings.some(f => f.relation === "exact_label_match") ? "brand impersonation (exact)" : r.findings.some(f => /homoglyph|lookalike|1_edit/.test(f.relation)) ? "high (look-alike)" : "elevated (brand token present)",
      matched_brands: [...new Set((r.findings || []).map(f => f.brand))] };
  },
  "data/gas"(r) {
    if (r.base_fee_gwei === undefined) return null;
    return { good_time_to_transact: r.congestion === "low",
      band: r.congestion, human_summary: `Base is ${r.congestion} congestion right now — ${r.congestion === "low" ? "a cheap time to send transactions" : r.congestion === "moderate" ? "normal fees" : "consider waiting if non-urgent"}.` };
  },
  "data/activity"(r) {
    if (r.transfer_count === undefined) return null;
    const conc = r.unique_senders > 0 ? r.transfer_count / r.unique_senders : 0;
    return { concentration: conc > 5 ? "concentrated (few wallets, many transfers — possible bot/wash)" : conc > 1.5 ? "moderate" : "well-distributed",
      liquidity_signal: r.activity_level === "high" ? "actively traded" : r.activity_level === "dormant" ? "no recent activity" : "some activity",
      transfers_per_sender: Number(conc.toFixed(2)) };
  },
  "data/supply"(r) {
    if (!r.total_supply) return null;
    return { deflationary_signal: r.burned_pct > 0 ? `${r.burned_pct}% of supply burned` : "no burns to dead addresses detected",
      supply_note: "Circulating = total − known burn addresses. Locked/vested supply is not deducted." };
  },
  "data/portfolio"(r) {
    if (!r.token_balances) return null;
    const held = Object.entries(r.token_balances).filter(([, v]) => parseFloat(v) > 0).map(([k]) => k);
    return { has_eth: parseFloat(r.eth_balance) > 0,
      stablecoins_held: held.filter(s => s === "USDC" || s === "EURC"),
      assets_present: held, empty_wallet: held.length === 0 && parseFloat(r.eth_balance) === 0 };
  }
};

export function enrich(routeStem, baseResponse) {
  try {
    const fn = enrichers[routeStem];
    if (!fn || !baseResponse || typeof baseResponse !== "object" || baseResponse.error) return baseResponse;
    const extra = fn(baseResponse);
    if (!extra) return baseResponse;
    return { ...baseResponse, enrichment: extra };
  } catch { return baseResponse; } // enrichment must never break a base response
}
