// Guards on the claims ChainVerdict publishes about itself.
//
// The audit of 24 August found /v1/methodology telling buyers to verify a
// "compact JWS" against /.well-known/signing-key.json. There is no JWS here:
// the scheme is an x-signature header over canonical JSON, and the key endpoint
// publishes base64 SPKI, not a JWK set. Three other surfaces described it
// correctly. The one document whose whole job is telling a stranger how to
// verify was the one that was wrong, and an agent following it would have
// concluded a perfectly valid signature had failed.
//
// These tests exist because that class of defect returns HTTP 200.
import test from "node:test";
import assert from "node:assert/strict";
import { methodologyDocument } from "../src/evidence.js";

const doc = methodologyDocument({});

test("methodology does not claim a JWS this service does not produce", () => {
  const sig = doc.evidenceModel.signature;
  assert.doesNotMatch(sig, /compact JWS/i, "ChainVerdict signs with x-signature headers, not JWS");
  assert.doesNotMatch(sig, /JWK/i);
  assert.match(sig, /x-signature/, "the actual scheme must be named");
  assert.match(sig, /x-signed-at/, "the timestamp binding is part of the signed payload");
  assert.match(sig, /SPKI/i, "the published key format must be named");
});

test("methodology names the header scheme and where it can be verified", () => {
  // Since 2 Oct 2026 the /verify page checks header signatures too; the public
  // document must say where, not that it cannot be done.
  assert.match(doc.evidenceModel.signature, /not the compact-JWS/i);
  assert.match(doc.evidenceModel.signature, /pulse\.chainverdict\.xyz\/verify checks both forms/);
});

test("no numeric-confidence language anywhere in the methodology", () => {
  const flat = JSON.stringify(doc);
  assert.doesNotMatch(flat, /how confident/i, "assurance is ordinal; 'confident' invites a number");
  assert.doesNotMatch(flat, /"confidence"/, "there is no confidence field — the field is assurance");
});

test("every published assurance level is an ordinal label, never a number", () => {
  for (const e of doc.endpoints) {
    assert.equal(typeof e.assurance.level, "string", `${e.pathPrefix} assurance.level must be a label`);
    assert.doesNotMatch(e.assurance.level, /^[\d.]+$/, `${e.pathPrefix} assurance.level looks numeric`);
    assert.ok(e.limitations?.length, `${e.pathPrefix} must state what it does not establish`);
  }
});
