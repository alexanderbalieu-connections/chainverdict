// Deterministic finance validators — pure functions, zero upstream dependencies.

const IBAN_LENGTHS = {
  AD:24,AE:23,AL:28,AT:20,AZ:28,BA:20,BE:16,BG:22,BH:22,BR:29,CH:21,CR:22,
  CY:28,CZ:24,DE:22,DK:18,DO:28,EE:20,ES:24,FI:18,FO:18,FR:27,GB:22,GE:22,
  GI:23,GL:18,GR:27,GT:28,HR:21,HU:28,IE:22,IL:23,IS:26,IT:27,JO:30,KW:30,
  KZ:20,LB:28,LI:21,LT:20,LU:20,LV:21,MC:27,MD:24,ME:22,MK:19,MR:27,MT:31,
  MU:30,NL:18,NO:15,PK:24,PL:28,PS:29,PT:25,QA:29,RO:24,RS:22,SA:24,SE:24,
  SI:19,SK:24,SM:27,TN:24,TR:26,UA:29,VG:24,XK:20
};

function mod97(numStr) {
  let rem = 0;
  for (let i = 0; i < numStr.length; i += 7) {
    rem = Number(String(rem) + numStr.slice(i, i + 7)) % 97;
  }
  return rem;
}

export function validateIBAN(input) {
  const iban = String(input || "").replace(/\s+/g, "").toUpperCase();
  const res = { input, normalized: iban, valid: false, checks: {} };
  res.checks.format = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban);
  if (!res.checks.format) return { ...res, reason: "malformed" };
  const cc = iban.slice(0, 2);
  res.country = cc;
  res.checks.country_known = cc in IBAN_LENGTHS;
  res.checks.length = IBAN_LENGTHS[cc] ? iban.length === IBAN_LENGTHS[cc] : false;
  if (!res.checks.length) return { ...res, reason: "wrong_length_for_country" };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  res.checks.mod97 = mod97(numeric) === 1;
  res.valid = res.checks.format && res.checks.length && res.checks.mod97;
  if (res.valid) { res.bban = iban.slice(4); }
  else res.reason = "checksum_failed";
  return res;
}

// VAT format patterns for EU members (+GB, CH for convenience)
const VAT_PATTERNS = {
  AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/, GR: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/, NL: /^NL[A-Z0-9+*]{10}\d{2}$/.source ? /^NL[A-Z0-9]{9}B\d{2}$/ : null,
  PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/, SE: /^SE\d{10}01$/,
  SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  CH: /^CHE\d{9}(MWST|TVA|IVA)?$/
};

// Deterministic checksum algorithms where they exist and are public.
const VAT_CHECKSUMS = {
  LU(num) { // LU: first 6 digits mod 89 === last 2
    const d = num.match(/^LU(\d{6})(\d{2})$/);
    return d ? Number(d[1]) % 89 === Number(d[2]) : false;
  },
  DE(num) { // ISO 7064 MOD 11,10 variant
    const d = num.match(/^DE(\d{9})$/); if (!d) return false;
    const digits = d[1].split("").map(Number);
    let p = 10;
    for (let i = 0; i < 8; i++) {
      let s = (digits[i] + p) % 10; if (s === 0) s = 10;
      p = (2 * s) % 11;
    }
    let check = 11 - p; if (check === 10) check = 0;
    return check === digits[8];
  },
  IT(num) { // Luhn on 11 digits
    const d = num.match(/^IT(\d{11})$/); if (!d) return false;
    const digits = d[1].split("").map(Number);
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      let v = digits[i];
      if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; }
      sum += v;
    }
    return sum % 10 === 0;
  },
  PL(num) {
    const d = num.match(/^PL(\d{10})$/); if (!d) return false;
    const w = [6,5,7,2,3,4,5,6,7];
    const digits = d[1].split("").map(Number);
    const sum = w.reduce((a, wi, i) => a + wi * digits[i], 0);
    return sum % 11 === digits[9];
  },
  SI(num) {
    const d = num.match(/^SI(\d{8})$/); if (!d) return false;
    const digits = d[1].split("").map(Number);
    const w = [8,7,6,5,4,3,2];
    let c = 11 - (w.reduce((a, wi, i) => a + wi * digits[i], 0) % 11);
    if (c === 10) c = 0; if (c === 11) return false;
    return c === digits[7];
  }
};

export function validateVAT(input) {
  const vat = String(input || "").replace(/[\s.-]/g, "").toUpperCase();
  const cc = vat.slice(0, 2);
  const res = { input, normalized: vat, country: cc, valid: false, checks: {} };
  const pattern = VAT_PATTERNS[cc];
  if (!pattern) return { ...res, reason: "unknown_country_prefix" };
  res.checks.format = pattern.test(vat);
  if (!res.checks.format) return { ...res, reason: "format_invalid" };
  if (VAT_CHECKSUMS[cc]) {
    res.checks.checksum = VAT_CHECKSUMS[cc](vat);
    res.valid = res.checks.checksum;
    if (!res.valid) res.reason = "checksum_failed";
  } else {
    res.checks.checksum = null; // no public deterministic checksum — format-level validation only
    res.valid = true;
    res.note = "format_valid_checksum_not_verifiable_offline";
  }
  return res;
}

export function validateBIC(input) {
  const bic = String(input || "").replace(/\s+/g, "").toUpperCase();
  const res = { input, normalized: bic, valid: false, checks: {} };
  res.checks.format = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
  if (!res.checks.format) return { ...res, reason: "format_invalid" };
  res.parts = {
    bank: bic.slice(0, 4), country: bic.slice(4, 6),
    location: bic.slice(6, 8), branch: bic.length === 11 ? bic.slice(8) : "XXX"
  };
  res.checks.test_bic = bic[7] === "0"; // '0' in position 8 = test BIC
  res.valid = true;
  return res;
}
