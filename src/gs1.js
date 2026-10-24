// GS1 prefix ranges (the numbering organisation that licensed the company
// prefix) and GS1 Application Identifier (AI) element-string decoding.
//
// Honest caveat surfaced in the API: a GS1 prefix identifies the GS1 Member
// Organisation that issued the company prefix — NOT the country of manufacture
// or origin. Agents (and their operators) conflate these constantly.

// Compact range table: [startInclusive, endInclusive, label]. First 3 digits.
const PREFIX_RANGES = [
  [0, 19, 'GS1 US (UPC-A compatible)'],
  [20, 29, 'Restricted distribution (in-store / MO defined)'],
  [30, 39, 'GS1 US'],
  [40, 49, 'Restricted distribution (company internal)'],
  [50, 59, 'Coupons (GS1 US)'],
  [60, 139, 'GS1 US'],
  [200, 299, 'Restricted distribution (MO defined)'],
  [300, 379, 'GS1 France'],
  [380, 380, 'GS1 Bulgaria'],
  [383, 383, 'GS1 Slovenia'],
  [385, 385, 'GS1 Croatia'],
  [387, 387, 'GS1 Bosnia and Herzegovina'],
  [389, 389, 'GS1 Montenegro'],
  [390, 390, 'GS1 Kosovo'],
  [400, 440, 'GS1 Germany'],
  [450, 459, 'GS1 Japan'],
  [460, 469, 'GS1 Russia'],
  [470, 470, 'GS1 Kyrgyzstan'],
  [471, 471, 'GS1 Taiwan'],
  [474, 474, 'GS1 Estonia'],
  [475, 475, 'GS1 Latvia'],
  [476, 476, 'GS1 Azerbaijan'],
  [477, 477, 'GS1 Lithuania'],
  [478, 478, 'GS1 Uzbekistan'],
  [479, 479, 'GS1 Sri Lanka'],
  [480, 480, 'GS1 Philippines'],
  [481, 481, 'GS1 Belarus'],
  [482, 482, 'GS1 Ukraine'],
  [483, 483, 'GS1 Turkmenistan'],
  [484, 484, 'GS1 Moldova'],
  [485, 485, 'GS1 Armenia'],
  [486, 486, 'GS1 Georgia'],
  [487, 487, 'GS1 Kazakhstan'],
  [488, 488, 'GS1 Tajikistan'],
  [489, 489, 'GS1 Hong Kong'],
  [490, 499, 'GS1 Japan'],
  [500, 509, 'GS1 UK'],
  [520, 521, 'GS1 Greece'],
  [528, 528, 'GS1 Lebanon'],
  [529, 529, 'GS1 Cyprus'],
  [530, 530, 'GS1 Albania'],
  [531, 531, 'GS1 North Macedonia'],
  [535, 535, 'GS1 Malta'],
  [539, 539, 'GS1 Ireland'],
  [540, 549, 'GS1 Belgium & Luxembourg'],
  [560, 560, 'GS1 Portugal'],
  [569, 569, 'GS1 Iceland'],
  [570, 579, 'GS1 Denmark'],
  [590, 590, 'GS1 Poland'],
  [594, 594, 'GS1 Romania'],
  [599, 599, 'GS1 Hungary'],
  [600, 601, 'GS1 South Africa'],
  [603, 603, 'GS1 Ghana'],
  [604, 604, 'GS1 Senegal'],
  [608, 608, 'GS1 Bahrain'],
  [609, 609, 'GS1 Mauritius'],
  [611, 611, 'GS1 Morocco'],
  [613, 613, 'GS1 Algeria'],
  [615, 615, 'GS1 Nigeria'],
  [616, 616, 'GS1 Kenya'],
  [618, 618, "GS1 Côte d'Ivoire"],
  [619, 619, 'GS1 Tunisia'],
  [620, 620, 'GS1 Tanzania'],
  [621, 621, 'GS1 Syria'],
  [622, 622, 'GS1 Egypt'],
  [623, 623, 'GS1 Brunei'],
  [624, 624, 'GS1 Libya'],
  [625, 625, 'GS1 Jordan'],
  [626, 626, 'GS1 Iran'],
  [627, 627, 'GS1 Kuwait'],
  [628, 628, 'GS1 Saudi Arabia'],
  [629, 629, 'GS1 United Arab Emirates'],
  [630, 630, 'GS1 Qatar'],
  [631, 631, 'GS1 Namibia'],
  [640, 649, 'GS1 Finland'],
  [690, 699, 'GS1 China'],
  [700, 709, 'GS1 Norway'],
  [729, 729, 'GS1 Israel'],
  [730, 739, 'GS1 Sweden'],
  [740, 740, 'GS1 Guatemala'],
  [741, 741, 'GS1 El Salvador'],
  [742, 742, 'GS1 Honduras'],
  [743, 743, 'GS1 Nicaragua'],
  [744, 744, 'GS1 Costa Rica'],
  [745, 745, 'GS1 Panama'],
  [746, 746, 'GS1 Dominican Republic'],
  [750, 750, 'GS1 Mexico'],
  [754, 755, 'GS1 Canada'],
  [759, 759, 'GS1 Venezuela'],
  [760, 769, 'GS1 Switzerland'],
  [770, 771, 'GS1 Colombia'],
  [773, 773, 'GS1 Uruguay'],
  [775, 775, 'GS1 Peru'],
  [777, 777, 'GS1 Bolivia'],
  [778, 779, 'GS1 Argentina'],
  [780, 780, 'GS1 Chile'],
  [784, 784, 'GS1 Paraguay'],
  [786, 786, 'GS1 Ecuador'],
  [789, 790, 'GS1 Brazil'],
  [800, 839, 'GS1 Italy'],
  [840, 849, 'GS1 Spain'],
  [850, 850, 'GS1 Cuba'],
  [858, 858, 'GS1 Slovakia'],
  [859, 859, 'GS1 Czech Republic'],
  [860, 860, 'GS1 Serbia'],
  [865, 865, 'GS1 Mongolia'],
  [867, 867, 'GS1 North Korea'],
  [868, 869, 'GS1 Turkey'],
  [870, 879, 'GS1 Netherlands'],
  [880, 881, 'GS1 South Korea'],
  [883, 883, 'GS1 Myanmar'],
  [884, 884, 'GS1 Cambodia'],
  [885, 885, 'GS1 Thailand'],
  [888, 888, 'GS1 Singapore'],
  [890, 890, 'GS1 India'],
  [893, 893, 'GS1 Vietnam'],
  [896, 896, 'GS1 Pakistan'],
  [899, 899, 'GS1 Indonesia'],
  [900, 919, 'GS1 Austria'],
  [930, 939, 'GS1 Australia'],
  [940, 949, 'GS1 New Zealand'],
  [950, 950, 'GS1 Global Office'],
  [951, 951, 'GS1 Global Office (EPC general manager)'],
  [955, 955, 'GS1 Malaysia'],
  [958, 958, 'GS1 Macau'],
  [960, 969, 'GS1 Global Office (GTIN-8 allocations)'],
  [977, 977, 'Serial publications (ISSN)'],
  [978, 979, 'Bookland (ISBN / ISMN)'],
  [980, 980, 'Refund receipts'],
  [981, 984, 'GS1 coupon identification (common currency)'],
  [990, 999, 'GS1 coupon identification'],
];

export function lookupPrefix(gtinOrPrefix) {
  const code = String(gtinOrPrefix).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code)) return { found: false, reason: 'non-numeric' };
  const gtin13 = code.length >= 13 ? code.slice(-13).slice(0, 13)
    : code.padStart(13, '0');
  const p3 = Number(gtin13.slice(0, 3));
  let label = null;
  for (const [lo, hi, name] of PREFIX_RANGES) {
    if (p3 >= lo && p3 <= hi) { label = name; break; }
  }
  return {
    found: label != null,
    prefix3: gtin13.slice(0, 3),
    memberOrganisation: label,
    note:
      'Identifies the GS1 Member Organisation that licensed the company prefix — NOT the country of manufacture or origin.',
  };
}

// ---------- GS1 Application Identifiers ----------
// Table of common AIs: code -> { name, len (fixed) OR maxLen (variable), kind }.
// kind: 'string' | 'date6' (YYMMDD) | 'numeric' | 'decimal' (last digit of AI = decimals)
const AIS = {
  '00': { name: 'SSCC', len: 18, kind: 'numeric' },
  '01': { name: 'GTIN', len: 14, kind: 'gtin' },
  '02': { name: 'GTIN of contained trade items', len: 14, kind: 'gtin' },
  '10': { name: 'Batch/Lot number', maxLen: 20, kind: 'string' },
  '11': { name: 'Production date', len: 6, kind: 'date6' },
  '12': { name: 'Due date', len: 6, kind: 'date6' },
  '13': { name: 'Packaging date', len: 6, kind: 'date6' },
  '15': { name: 'Best before date', len: 6, kind: 'date6' },
  '16': { name: 'Sell by date', len: 6, kind: 'date6' },
  '17': { name: 'Expiration date', len: 6, kind: 'date6' },
  '20': { name: 'Variant', len: 2, kind: 'numeric' },
  '21': { name: 'Serial number', maxLen: 20, kind: 'string' },
  '22': { name: 'Consumer product variant', maxLen: 20, kind: 'string' },
  '240': { name: 'Additional product identification', maxLen: 30, kind: 'string' },
  '241': { name: 'Customer part number', maxLen: 30, kind: 'string' },
  '30': { name: 'Variable count', maxLen: 8, kind: 'numeric' },
  '37': { name: 'Count of trade items', maxLen: 8, kind: 'numeric' },
  '400': { name: 'Customer purchase order number', maxLen: 30, kind: 'string' },
  '410': { name: 'Ship to / deliver to GLN', len: 13, kind: 'numeric' },
  '412': { name: 'Purchased from GLN', len: 13, kind: 'numeric' },
  '414': { name: 'Physical location GLN', len: 13, kind: 'numeric' },
  '420': { name: 'Ship to / deliver to postal code', maxLen: 20, kind: 'string' },
  '421': { name: 'Ship to / deliver to postal code with ISO country', maxLen: 12, kind: 'string' },
  '3100': { name: 'Net weight (kg)', len: 6, kind: 'decimal', decimals: 0 },
  '3101': { name: 'Net weight (kg)', len: 6, kind: 'decimal', decimals: 1 },
  '3102': { name: 'Net weight (kg)', len: 6, kind: 'decimal', decimals: 2 },
  '3103': { name: 'Net weight (kg)', len: 6, kind: 'decimal', decimals: 3 },
  '3200': { name: 'Net weight (lb)', len: 6, kind: 'decimal', decimals: 0 },
  '3202': { name: 'Net weight (lb)', len: 6, kind: 'decimal', decimals: 2 },
};

function parseDate6(s) {
  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  // GS1 rule: YY 51-99 => 19YY, 00-50 => 20YY (relative window is spec-defined;
  // this is the widely-used convention).
  const year = yy >= 51 ? 1900 + yy : 2000 + yy;
  if (mm < 1 || mm > 12) return { iso: null, valid: false, reason: `month ${mm} out of range` };
  // dd == 00 is allowed by GS1 to mean "end of month" — surface it honestly.
  const endOfMonth = dd === 0;
  if (!endOfMonth && (dd < 1 || dd > 31)) return { iso: null, valid: false, reason: `day ${dd} out of range` };
  const iso = endOfMonth
    ? `${year}-${String(mm).padStart(2, '0')}-00`
    : `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return { iso, valid: true, endOfMonth };
}

/**
 * Decode a GS1 element string in either human form "(01)0952...(17)261231(10)ABC"
 * or raw form using FNC1 (ASCII 29 / <GS>) between variable-length fields.
 * Returns { valid, elements: [{ai, name, raw, value, ...}], errors }.
 */
export function decodeGs1(input) {
  const errors = [];
  const elements = [];
  const hasParens = input.includes('(');
  const FNC1 = '\x1d';

  if (hasParens) {
    // Split on "(NNN)" markers.
    const parts = input.split(/\((\d{2,4})\)/).filter((x) => x !== '');
    for (let i = 0; i < parts.length; i += 2) {
      const ai = parts[i];
      const val = parts[i + 1] ?? '';
      pushElement(ai, val);
    }
  } else {
    // Raw stream: consume AI by longest-prefix match, then fixed or FNC1-terminated.
    let s = input.replace(/\s/g, '');
    while (s.length > 0) {
      let ai = null;
      for (const len of [2, 3, 4]) {
        const cand = s.slice(0, len);
        if (AIS[cand]) { ai = cand; break; }
      }
      if (!ai) { errors.push(`unknown AI at "${s.slice(0, 4)}…"`); break; }
      s = s.slice(ai.length);
      const def = AIS[ai];
      let val;
      if (def.len && def.kind !== 'string') {
        val = s.slice(0, def.len);
        s = s.slice(def.len);
      } else {
        const fnc = s.indexOf(FNC1);
        if (fnc >= 0) { val = s.slice(0, fnc); s = s.slice(fnc + 1); }
        else { val = s.slice(0, def.maxLen ?? def.len); s = s.slice(val.length); }
      }
      pushElement(ai, val);
    }
  }
  return { valid: errors.length === 0, input, elements, errors };

  function pushElement(ai, rawVal) {
    const def = AIS[ai];
    if (!def) { errors.push(`unknown AI (${ai})`); return; }
    const el = { ai, name: def.name, raw: rawVal };
    if (def.kind === 'date6') {
      if (!/^\d{6}$/.test(rawVal)) { errors.push(`AI ${ai} expects YYMMDD, got "${rawVal}"`); }
      else {
        const d = parseDate6(rawVal);
        el.value = d.iso;
        el.valid = d.valid;
        if (d.endOfMonth) el.note = 'day 00 = end of month per GS1';
        if (!d.valid) errors.push(`AI ${ai}: ${d.reason}`);
      }
    } else if (def.kind === 'gtin') {
      el.value = rawVal;
      const v = validateGtinInternal(rawVal);
      el.gtinValid = v;
      if (!v) errors.push(`AI ${ai}: GTIN check digit invalid`);
    } else if (def.kind === 'decimal') {
      const n = Number(rawVal);
      el.value = def.decimals ? n / Math.pow(10, def.decimals) : n;
    } else {
      el.value = rawVal;
      if (def.len && rawVal.length !== def.len) errors.push(`AI ${ai} expects ${def.len} chars, got ${rawVal.length}`);
      if (def.maxLen && rawVal.length > def.maxLen) errors.push(`AI ${ai} exceeds max ${def.maxLen} chars`);
    }
    elements.push(el);
  }
}

// local import to avoid circular ref cost
function validateGtinInternal(code) {
  const c = String(code).replace(/[\s-]/g, '');
  if (!/^\d{8}$|^\d{12,14}$/.test(c)) return false;
  let sum = 0;
  const body = c.slice(0, -1);
  for (let i = 0; i < body.length; i++) sum += (body.charCodeAt(body.length - 1 - i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === c.charCodeAt(c.length - 1) - 48;
}
