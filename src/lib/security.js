// Deterministic security-posture checks. All factual lookups — DNS + TLS handshake —
// no heuristic "trust scores". Every response states exactly what was and wasn't checked.
import { Resolver } from "node:dns/promises";
import tls from "node:tls";

const resolver = new Resolver({ timeout: 5000, tries: 2 });

function cleanDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return d;
}
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// ---- Email authentication posture: SPF + DMARC + optional DKIM selector ----
export async function emailPosture(input, selector) {
  const domain = cleanDomain(input);
  if (!DOMAIN_RE.test(domain)) return { error: "invalid_domain", input };
  const res = { domain, checked_at: new Date().toISOString(), checks: {} };

  // SPF
  try {
    const txt = (await resolver.resolveTxt(domain)).map(a => a.join(""));
    const spf = txt.find(t => t.toLowerCase().startsWith("v=spf1"));
    res.checks.spf = spf
      ? { present: true, record: spf, policy: /-all/.test(spf) ? "hardfail" : /~all/.test(spf) ? "softfail" : /\?all/.test(spf) ? "neutral" : "unspecified" }
      : { present: false, note: "No SPF record — sender IPs are not authorized; domain easier to spoof." };
  } catch (e) { res.checks.spf = { present: false, error: String(e.code || e.message) }; }

  // DMARC
  try {
    const txt = (await resolver.resolveTxt(`_dmarc.${domain}`)).map(a => a.join(""));
    const dmarc = txt.find(t => t.toLowerCase().startsWith("v=dmarc1"));
    const pol = dmarc && /p=(\w+)/.exec(dmarc)?.[1];
    res.checks.dmarc = dmarc
      ? { present: true, record: dmarc, policy: pol || "unspecified",
          enforced: pol === "reject" || pol === "quarantine" }
      : { present: false, note: "No DMARC record — spoofed mail is not automatically rejected." };
  } catch (e) { res.checks.dmarc = { present: false, error: String(e.code || e.message) }; }

  // DKIM (only if a selector is provided — DKIM can't be enumerated)
  if (selector) {
    try {
      const txt = (await resolver.resolveTxt(`${selector}._domainkey.${domain}`)).map(a => a.join(""));
      const dk = txt.find(t => /v=DKIM1|k=rsa|p=/i.test(t));
      res.checks.dkim = dk ? { present: true, selector, record_preview: dk.slice(0, 60) + "…" }
                           : { present: false, selector, note: "No DKIM key at this selector." };
    } catch (e) { res.checks.dkim = { present: false, selector, error: String(e.code || e.message) }; }
  } else {
    res.checks.dkim = { checked: false, note: "DKIM not checked — provide ?selector= (DKIM selectors cannot be enumerated)." };
  }

  const spfOk = res.checks.spf.present;
  const dmarcEnforced = res.checks.dmarc.enforced;
  res.posture = dmarcEnforced && spfOk ? "protected"
              : spfOk || res.checks.dmarc.present ? "partial"
              : "unprotected";
  res.disclaimer = "Factual DNS record check at query time. Presence of records is not a guarantee of correct configuration or delivery behaviour.";
  return res;
}

// ---- TLS certificate posture ----
export function tlsPosture(input) {
  const host = cleanDomain(input);
  if (!DOMAIN_RE.test(host)) return Promise.resolve({ error: "invalid_domain", input });
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authError = socket.authorizationError ? String(socket.authorizationError) : null;
      const now = Date.now();
      const validTo = cert.valid_to ? new Date(cert.valid_to).getTime() : null;
      const validFrom = cert.valid_from ? new Date(cert.valid_from).getTime() : null;
      const daysToExpiry = validTo ? Math.floor((validTo - now) / 86400000) : null;
      resolve({
        host, checked_at: new Date().toISOString(),
        tls_authorized: authorized,
        authorization_error: authError,
        protocol: socket.getProtocol(),
        subject_cn: cert.subject?.CN || null,
        issuer_cn: cert.issuer?.CN || null,
        valid_from: cert.valid_from || null,
        valid_to: cert.valid_to || null,
        days_to_expiry: daysToExpiry,
        expired: validTo ? now > validTo : null,
        not_yet_valid: validFrom ? now < validFrom : null,
        san_count: cert.subjectaltname ? cert.subjectaltname.split(",").length : 0,
        posture: authorized && daysToExpiry > 14 ? "ok"
               : authorized && daysToExpiry > 0 ? "expiring_soon"
               : "invalid_or_expired",
        disclaimer: "Live TLS handshake at query time. Reflects the certificate served now; does not audit cipher strength or full chain policy."
      });
      socket.end();
    });
    socket.on("error", (e) => resolve({ host, tls_authorized: false, posture: "handshake_failed", error: String(e.code || e.message), checked_at: new Date().toISOString() }));
    socket.on("timeout", () => { socket.destroy(); resolve({ host, posture: "timeout", checked_at: new Date().toISOString() }); });
  });
}

// ---- Typosquat / look-alike structural analysis against a brand list ----
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
const HOMOGLYPHS = { "0":"o","1":"l","3":"e","4":"a","5":"s","7":"t","rn":"m","vv":"w" };

export function typosquatCheck(input, brandsCsv) {
  const domain = cleanDomain(input);
  if (!DOMAIN_RE.test(domain)) return { error: "invalid_domain", input };
  const brands = String(brandsCsv || "coinbase,binance,metamask,circle,usdc,ledger,phantom,uniseswap,opensea,kraken,revolut")
    .split(",").map(b => b.trim().toLowerCase()).filter(Boolean);
  const label = domain.split(".")[0];
  const normalized = Object.entries(HOMOGLYPHS).reduce((s, [k, v]) => s.split(k).join(v), label);
  // Sub-tokens too, so "coinbase-wallet" / "secure-binance" are caught.
  const tokens = [...new Set([label, normalized, ...label.split(/[-_.]/), ...normalized.split(/[-_.]/)])].filter(Boolean);
  const findings = [];
  for (const brand of brands) {
    if (brand.length < 4) continue;
    let hit = null;
    if (label === brand || normalized === brand) hit = { brand, relation: "exact_label_match", distance: 0 };
    else if (tokens.includes(brand)) hit = { brand, relation: "contains_brand_token", normalized: normalized !== label ? normalized : undefined };
    else {
      const best = Math.min(...tokens.map(t => levenshtein(t, brand)));
      if (best <= 1) hit = { brand, relation: "homoglyph_or_1_edit_lookalike", distance: best, normalized: normalized !== label ? normalized : undefined };
      else if (levenshtein(label, brand) <= 2) hit = { brand, relation: "near_edit_distance", distance: levenshtein(label, brand) };
      else if (label.includes(brand)) hit = { brand, relation: "contains_brand_as_substring" };
    }
    if (hit) findings.push(hit);
  }
  return {
    domain, label, findings,
    suspicious: findings.length > 0,
    brands_checked: brands.length,
    disclaimer: "Structural string analysis only. A match indicates visual/edit similarity to a known brand — NOT proof of malicious intent. Absence of a match is not a safety guarantee.",
    checked_at: new Date().toISOString()
  };
}
