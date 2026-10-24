import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gs1CheckDigit, validateGtin, computeGtinCheckDigit, validateSscc,
  iso6346CheckDigit, validateContainer, validateImo,
} from '../src/identifiers.js';
import { lookupPrefix, decodeGs1 } from '../src/gs1.js';

test('GTIN check digit: known EAN-13 vectors', () => {
  // Real, verifiable barcodes.
  assert.equal(validateGtin('4006381333931').valid, true);   // classic EAN-13 test value
  assert.equal(validateGtin('0012345678905').valid, true);   // UPC-A padded to 13
  assert.equal(validateGtin('5000159484695').valid, true);   // a real EAN-13
  assert.equal(validateGtin('012345678905').valid, true);    // UPC-A (12)
  assert.equal(validateGtin('96385074').valid, true);        // EAN-8
});

test('GTIN check digit: detects a single-digit error', () => {
  const r = validateGtin('4006381333930'); // last digit wrong (should be 1)
  assert.equal(r.valid, false);
  assert.equal(r.expectedCheckDigit, 1);
  assert.equal(r.checkDigit, 0);
});

test('GTIN: wrong length and non-numeric are rejected cleanly', () => {
  assert.equal(validateGtin('12345').valid, false);
  assert.equal(validateGtin('40063813339ab').valid, false);
});

test('computeGtinCheckDigit matches the embedded digit', () => {
  assert.equal(computeGtinCheckDigit('400638133393'), 1);
  assert.equal(computeGtinCheckDigit('001234567890'), 5);
});

test('gs1CheckDigit primitive is stable', () => {
  assert.equal(gs1CheckDigit('400638133393'), 1);
});

test('SSCC-18 validation', () => {
  // Build a valid SSCC from a 17-digit body + computed check digit.
  const body = '10614141192837465'; // 17 digits
  const cd = gs1CheckDigit(body);
  assert.equal(validateSscc(body + cd).valid, true);
  assert.equal(validateSscc(body + ((cd + 1) % 10)).valid, false);
  assert.equal(validateSscc('123').valid, false);
});

test('ISO 6346 container: canonical CSQU3054383 validates', () => {
  // The example from the ISO 6346 standard; check digit 3.
  assert.equal(iso6346CheckDigit('CSQU305438'), 3);
  const r = validateContainer('CSQU3054383');
  assert.equal(r.valid, true);
  assert.equal(r.ownerCode, 'CSQ');
  assert.equal(r.categoryIdentifier, 'U');
  assert.equal(r.serialNumber, '305438');
});

test('ISO 6346: more real vectors and error detection', () => {
  assert.equal(validateContainer('MSKU3690137').valid, true);
  assert.equal(validateContainer('TCLU1234568').valid, true);
  assert.equal(validateContainer('MSCU1234566').valid, true);
  assert.equal(validateContainer('CSQU3054384').valid, false); // wrong check digit
  assert.equal(validateContainer('CSQX3054383').valid, false); // bad category X
  assert.equal(validateContainer('CSQ3054383').valid, false);  // malformed
});

test('IMO number: known-good and known-bad', () => {
  assert.equal(validateImo('IMO 9074729').valid, true);  // documented valid IMO
  assert.equal(validateImo('9074729').valid, true);
  assert.equal(validateImo('IMO 9074728').valid, false); // check digit wrong
  assert.equal(validateImo('IMO 123').valid, false);
});

test('GS1 prefix lookup with honest MO caveat', () => {
  const de = lookupPrefix('4006381333931');
  assert.match(de.memberOrganisation, /Germany/);
  const uk = lookupPrefix('5000159484695');
  assert.match(uk.memberOrganisation, /UK/);
  const bookland = lookupPrefix('9781234567897');
  assert.match(bookland.memberOrganisation, /Bookland|ISBN/);
  assert.match(de.note, /NOT the country of manufacture/);
});

test('GS1 element string decode: human-readable form', () => {
  const r = decodeGs1('(01)04006381333931(17)261231(10)ABC123');
  assert.equal(r.valid, true);
  const byAi = Object.fromEntries(r.elements.map((e) => [e.ai, e]));
  assert.equal(byAi['01'].gtinValid, true);
  assert.equal(byAi['17'].value, '2026-12-31');
  assert.equal(byAi['10'].value, 'ABC123');
});

test('GS1 element string decode: raw FNC1 form', () => {
  // (01) fixed 14, (10) variable terminated by FNC1, then (17) fixed 6
  const raw = '0104006381333931' + '10ABC123' + '\x1d' + '17261231';
  const r = decodeGs1(raw);
  assert.equal(r.valid, true);
  const byAi = Object.fromEntries(r.elements.map((e) => [e.ai, e]));
  assert.equal(byAi['01'].value, '04006381333931');
  assert.equal(byAi['10'].value, 'ABC123');
  assert.equal(byAi['17'].value, '2026-12-31');
});

test('GS1 decode: end-of-month day 00 is flagged, not rejected', () => {
  const r = decodeGs1('(15)261200');
  assert.equal(r.valid, true);
  assert.equal(r.elements[0].value, '2026-12-00');
  assert.match(r.elements[0].note, /end of month/);
});

test('GS1 decode: bad date surfaces an error', () => {
  const r = decodeGs1('(17)261331'); // month 13
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});
