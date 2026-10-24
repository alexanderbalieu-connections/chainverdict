// Deterministic trade & logistics identifier primitives.
// Every function here is pure math over public specifications (GS1 General
// Specifications, ISO 6346, IMO ship-numbering). No upstream calls, no data
// that goes stale, no LLM. These are exactly the checks language models get
// wrong — a check digit is unforgiving, which is the point.

// ---------- GS1 modulo-10 check digit (GTIN, SSCC, GLN, SSCC-18) ----------
// The rightmost data digit is weighted 3, then alternating 1,3,1,3 leftward.
export function gs1CheckDigit(dataDigits) {
  if (!/^\d+$/.test(dataDigits)) throw new Error('data must be digits only');
  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const d = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48;
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Validate a GTIN / UPC-A (12) / UPC-E-expanded / EAN-13 (13) / GTIN-14.
 * Returns { valid, length, format, checkDigit, expectedCheckDigit, gtin14, indicator }.
 */
export function validateGtin(raw) {
  const code = String(raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code)) {
    return { valid: false, reason: 'non-numeric characters present', input: raw };
  }
  if (!GTIN_LENGTHS.has(code.length)) {
    return {
      valid: false,
      reason: `length ${code.length} is not a valid GTIN length (8, 12, 13, or 14)`,
      input: raw,
    };
  }
  const body = code.slice(0, -1);
  const given = code.charCodeAt(code.length - 1) - 48;
  const expected = gs1CheckDigit(body);
  const valid = given === expected;
  const format =
    code.length === 12 ? 'UPC-A (GTIN-12)'
      : code.length === 13 ? 'EAN-13 (GTIN-13)'
        : code.length === 8 ? 'EAN-8 (GTIN-8)'
          : 'GTIN-14';
  const gtin14 = code.padStart(14, '0');
  return {
    valid,
    input: raw,
    normalized: code,
    length: code.length,
    format,
    checkDigit: given,
    expectedCheckDigit: expected,
    gtin14,
    indicatorDigit: Number(gtin14[0]), // GTIN-14 packaging indicator (0 = base unit)
    reason: valid ? undefined : `check digit ${given} is wrong; expected ${expected}`,
  };
}

/** Compute the check digit for a code missing it (any GS1 key). */
export function computeGtinCheckDigit(bodyDigits) {
  const body = String(bodyDigits).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(body)) throw new Error('body must be digits only');
  return gs1CheckDigit(body);
}

/** Validate an SSCC-18 (serial shipping container code). */
export function validateSscc(raw) {
  const code = String(raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code)) return { valid: false, reason: 'non-numeric', input: raw };
  if (code.length !== 18) {
    return { valid: false, reason: `SSCC must be 18 digits, got ${code.length}`, input: raw };
  }
  const expected = gs1CheckDigit(code.slice(0, -1));
  const given = code.charCodeAt(17) - 48;
  const valid = given === expected;
  return {
    valid,
    input: raw,
    normalized: code,
    extensionDigit: Number(code[0]),
    checkDigit: given,
    expectedCheckDigit: expected,
    reason: valid ? undefined : `check digit ${given} is wrong; expected ${expected}`,
  };
}

// ---------- ISO 6346 shipping container number ----------
// 4 letters (3 owner + 1 category U/J/Z) + 6 digit serial + 1 check digit.
const ISO6346_VALUES = (() => {
  const map = {};
  let v = 10;
  for (let c = 65; c <= 90; c++) {
    if (v % 11 === 0) v++; // skip multiples of 11
    map[String.fromCharCode(c)] = v;
    v++;
  }
  return map;
})();

export function iso6346CheckDigit(elevenOrTen) {
  // Accept the 10-char body (4 letters + 6 digits); ignore an 11th if present.
  const s = String(elevenOrTen).toUpperCase().replace(/[\s-]/g, '').slice(0, 10);
  if (!/^[A-Z]{4}\d{6}$/.test(s)) throw new Error('expected 4 letters + 6 digits');
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    const val = /[A-Z]/.test(ch) ? ISO6346_VALUES[ch] : ch.charCodeAt(0) - 48;
    sum += val * Math.pow(2, i);
  }
  const cd = sum % 11;
  return cd === 10 ? 0 : cd;
}

export function validateContainer(raw) {
  const code = String(raw).toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{4}\d{7}$/.test(code)) {
    return {
      valid: false,
      input: raw,
      reason: 'ISO 6346 format is 4 letters + 7 digits (e.g. CSQU3054383)',
    };
  }
  const category = code[3];
  const categoryOk = ['U', 'J', 'Z'].includes(category);
  const expected = iso6346CheckDigit(code.slice(0, 10));
  const given = code.charCodeAt(10) - 48;
  const valid = given === expected && categoryOk;
  return {
    valid,
    input: raw,
    normalized: code,
    ownerCode: code.slice(0, 3),
    categoryIdentifier: category,
    serialNumber: code.slice(4, 10),
    checkDigit: given,
    expectedCheckDigit: expected,
    reason: valid
      ? undefined
      : !categoryOk
        ? `category identifier '${category}' must be U (freight), J (detachable equipment), or Z (trailer/chassis)`
        : `check digit ${given} is wrong; expected ${expected}`,
  };
}

// ---------- IMO ship identification number ----------
// "IMO 1234567": 6 digits weighted 7..2, sum mod 10 = 7th digit.
export function validateImo(raw) {
  const code = String(raw).toUpperCase().replace(/^IMO/, '').replace(/[\s-]/g, '');
  if (!/^\d{7}$/.test(code)) {
    return { valid: false, input: raw, reason: 'IMO number is 7 digits (optionally prefixed "IMO")' };
  }
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += (code.charCodeAt(i) - 48) * (7 - i);
  const expected = sum % 10;
  const given = code.charCodeAt(6) - 48;
  const valid = given === expected;
  return {
    valid,
    input: raw,
    normalized: `IMO ${code}`,
    checkDigit: given,
    expectedCheckDigit: expected,
    reason: valid ? undefined : `check digit ${given} is wrong; expected ${expected}`,
  };
}
