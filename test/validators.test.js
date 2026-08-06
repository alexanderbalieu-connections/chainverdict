import test from "node:test";
import assert from "node:assert/strict";
import { validateIBAN, validateVAT, validateBIC } from "../src/lib/validators.js";

test("valid LU IBAN", () => assert.equal(validateIBAN("LU28 0019 4006 4475 0000").valid, true));
test("valid DE IBAN", () => assert.equal(validateIBAN("DE89 3704 0044 0532 0130 00").valid, true));
test("valid GB IBAN", () => assert.equal(validateIBAN("GB29 NWBK 6016 1331 9268 19").valid, true));
test("bad checksum IBAN", () => assert.equal(validateIBAN("DE89370400440532013001").valid, false));
test("wrong length IBAN", () => { const r = validateIBAN("LU2800194006447500001"); assert.equal(r.valid, false); assert.equal(r.reason, "wrong_length_for_country"); });
test("garbage IBAN", () => assert.equal(validateIBAN("HELLO WORLD").valid, false));

test("valid DE VAT checksum", () => assert.equal(validateVAT("DE136695976").valid, true));
test("bad DE VAT checksum", () => assert.equal(validateVAT("DE136695970").valid, false));
test("valid IT VAT (Luhn)", () => assert.equal(validateVAT("IT00743110157").valid, true));
test("bad IT VAT", () => assert.equal(validateVAT("IT00743110158").valid, false));
test("LU VAT format+mod89", () => { const r = validateVAT("LU26375245"); assert.equal(r.checks.format, true); });
test("FR VAT format-only", () => { const r = validateVAT("FRXX123456789"); assert.equal(r.checks.format, true); assert.equal(r.checks.checksum, null); });
test("unknown VAT country", () => assert.equal(validateVAT("ZZ12345678").valid, false));

test("valid BIC 8", () => { const r = validateBIC("BGLLLULL"); assert.equal(r.valid, true); assert.equal(r.parts.country, "LU"); });
test("valid BIC 11", () => assert.equal(validateBIC("DEUTDEFF500").valid, true));
test("bad BIC", () => assert.equal(validateBIC("123").valid, false));
