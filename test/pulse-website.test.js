import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPulsePage, pulseWebsite } from "../src/pulse-website.js";

test("Pulse pages keep people on the apex and keep API links on their existing host", () => {
  assert.equal(
    canonicalPulsePage('<a href="/evidence.html#live-check"><script src="/integration/live-check.js"></script><a href="https://trade.chainverdict.xyz/"><a href="/v1/feed/sample">'),
    '<a href="/pulse/evidence.html#live-check"><script src="/pulse/integration/live-check.js"></script><a href="/traderails"><a href="https://pulse.chainverdict.xyz/v1/feed/sample">',
  );
});

test("the website proxy excludes paid and unlisted requests", () => {
  for (const path of ["/pulse/v1/verdict", "/pulse/v1/feed", "/pulse/v1/archive/full", "/pulse/integration/../v1/feed", "/pulse/_website/index.html", "/pulse/v1/owner/other"]) {
    pulseWebsite({ path, method: "GET" }, { sendStatus: status => assert.equal(status, 404) }, () => assert.fail(path));
  }
});
