// TradeRails evidence layer. Same principle as the rest of the portfolio: every
// paid answer states what was checked, how it was produced, and what it does
// NOT mean. Deterministic check-digit maths is certain about the arithmetic and
// silent about the real world — that distinction is the product.

export const METHODOLOGY_VERSION = "tr-1.1.0";

const GLOBAL = [
  "TradeRails returns deterministic structural checks for automated decision support. It is not customs, legal, trade-compliance or regulatory advice, and it does not discharge any filing, classification or due-diligence obligation.",
  "A structurally valid identifier is NOT proof that the underlying product, container, vessel or shipment exists, is registered, or belongs to the party you are dealing with.",
];

const SEMANTICS = {
  assuranceIsNotAProbability:
    "assurance.level is an ORDINAL description of how the answer was produced. It is NOT a calibrated probability. 'deterministic' means the arithmetic of the check is certain — it does not mean there is a 100% chance the item is genuine, compliant or correctly described.",
  signatureProvesIntegrityNotTruth:
    "The Ed25519 signature proves TradeRails produced this exact response and it was not altered in transit. It does NOT prove the conclusion is correct. Integrity is not truth.",
  validStructureIsNotValidReality:
    "Passing a check digit means the identifier is internally consistent. Counterfeiters can and do generate structurally valid identifiers. A pass is a necessary condition, never a sufficient one.",
};

const REG = {
  "gtin.validate": { subject: "GTIN / UPC-A / EAN-13", checks: ["Length and numeric-set validation", "GS1 modulo-10 check digit", "GTIN-14 normalisation", "Packaging indicator extraction"], sources: [{ name: "GS1 General Specifications (bundled rules)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "the check-digit arithmetic is certain; nothing is looked up externally" }, limitations: ["Does NOT confirm the product exists, is on sale, or that the GTIN is licensed to any particular company.", "No GS1 registry, GEPIR or brand-owner lookup is performed."] },
  "gtin.checkdigit": { subject: "GS1 key body", checks: ["GS1 modulo-10 check-digit computation"], sources: [{ name: "GS1 General Specifications (bundled rules)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "pure arithmetic over the supplied digits" }, limitations: ["Computes the digit that would make the code well-formed. It does not assert that the resulting code is assigned to anything."] },
  "gtin.prefix": { subject: "GS1 prefix", checks: ["Prefix range lookup against the bundled GS1 Member Organisation table"], sources: [{ name: "GS1 prefix allocation table (bundled)", refresh: "with releases" }], assurance: { level: "exact-list-match", basis: "range match against a bundled table; the table can lag GS1 reallocations" }, limitations: ["Identifies the GS1 Member Organisation that ISSUED the company prefix. This is NOT the country of manufacture, origin, or of the brand owner. Conflating the two is the most common error with this field.", "Restricted-distribution and coupon ranges are internal-use codes, not consumer products."] },
  "sscc.validate": { subject: "SSCC-18 logistics unit", checks: ["18-digit length", "GS1 modulo-10 check digit", "Extension digit extraction"], sources: [{ name: "GS1 General Specifications (bundled rules)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "the check-digit arithmetic is certain" }, limitations: ["Does not confirm the logistics unit exists, was despatched, or matches any ASN or shipment record."] },
  "container.validate": { subject: "ISO 6346 container", checks: ["4-letter owner + category format", "Category identifier (U/J/Z) validity", "ISO 6346 check-digit computation"], sources: [{ name: "ISO 6346 (bundled rules)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "the ISO 6346 check-digit arithmetic is certain" }, limitations: ["Does NOT confirm the container exists, is in service, or that the owner prefix is registered with BIC. No registry lookup is performed.", "Says nothing about the container's location, contents or condition."] },
  "imo.validate": { subject: "IMO ship number", checks: ["7-digit format", "IMO weighted check-digit computation"], sources: [{ name: "IMO ship identification scheme (bundled rules)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "the weighted check-digit arithmetic is certain" }, limitations: ["Does NOT confirm the vessel exists, its name, flag, owner, class or operational status. No IHS/Equasis lookup is performed.", "Notably: this is NOT a sanctions or port-state check on the vessel."] },
  "gs1.decode": { subject: "GS1 element string", checks: ["Application Identifier parsing (human and FNC1 forms)", "Per-AI length and type validation", "Embedded GTIN check-digit verification", "YYMMDD date decoding incl. end-of-month convention"], sources: [{ name: "GS1 General Specifications, AI table (bundled)", refresh: "with releases" }], assurance: { level: "deterministic", basis: "parsing and validation are deterministic over the supplied string" }, limitations: ["Decodes what the string says. It does not verify that the batch, expiry, serial or weight are truthful, or that they match any physical item.", "The bundled AI table covers common identifiers; unknown AIs are reported as errors rather than guessed."] },
  "hs.classify": { subject: "goods description", checks: ["Lexical scoring against a curated subset of HS-2022 headings", "Ranked candidate headings with official heading text"], sources: [{ name: "Curated HS-2022 heading subset (bundled)", refresh: "with releases" }], assurance: { level: "heuristic", basis: "lexical string matching only; not validated against a labelled classification dataset and not calibrated" }, limitations: ["This is TRIAGE, not a customs ruling, and must not be used as the basis for a declaration. Confirm with a licensed customs broker before filing.", "Legal classification follows the General Rules of Interpretation (GRI 1-6), Section and Chapter Notes, and the 6-digit subheading — none of which this resolves.", "Coverage is a curated subset. Absence of a candidate means the bundled set does not cover the goods, NOT that they are unclassifiable.", "Duty rates, origin rules, trade remedies and national tariff lines are entirely out of scope."] },
};

export function buildEvidence(kind) {
  const spec = REG[kind];
  if (!spec) return null;
  return {
    methodologyVersion: METHODOLOGY_VERSION,
    decision: kind,
    subject: spec.subject,
    checksPerformed: spec.checks,
    dataSources: spec.sources,
    freshness: { basis: "deterministic", observedAt: new Date().toISOString(), guidance: "Deterministic result: stable for identical input. Bundled standards tables change only with a release." },
    assurance: spec.assurance,
    semantics: SEMANTICS,
    limitations: spec.limitations,
    globalLimitations: GLOBAL,
    methodology: "https://trade.chainverdict.xyz/v1/methodology",
    verifySignature: "https://trade.chainverdict.xyz/.well-known/signing-key.json",
  };
}

export function methodologyDocument() {
  return {
    service: "TradeRails", methodologyVersion: METHODOLOGY_VERSION, published: new Date().toISOString(),
    principle: "Deterministic structural checks over published standards (GS1, ISO 6346, IMO, HS-2022). Every paid answer states what was checked, how it was produced and what it does not mean. No LLM sits in the serving path.",
    evidenceModel: {
      assurance: "Ordinal, not numeric: deterministic / exact-list-match / heuristic. A number would imply a calibration TradeRails has not performed.",
      calibration: "TradeRails does not publish precision/recall for the heuristic HS classifier and does not claim it is calibrated. It is labelled heuristic so it is not mistaken for a validated classifier.",
      integrityVsTruth: "Signing proves provenance and integrity, not correctness. A signed wrong answer is still wrong, and still signed.",
      structureVsReality: "Check digits prove internal consistency. Counterfeiters generate structurally valid identifiers routinely. A pass is necessary, never sufficient.",
    },
    globalLimitations: GLOBAL, semantics: SEMANTICS,
    endpoints: Object.entries(REG).map(([k, v]) => ({ decision: k, subject: v.subject, checksPerformed: v.checks, dataSources: v.sources, assurance: v.assurance, limitations: v.limitations })),
    corrections: "Errors, false positives and false negatives can be reported to contact@chainverdict.xyz. Material changes increment methodologyVersion.",
  };
}
