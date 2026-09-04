// Mirror the 402 challenge into the response body.
//
// @x402/express 2.x puts the payment requirements only in the base64
// PAYMENT-REQUIRED header and sends a two-byte body, "{}". That is what the v2
// spec asks for, and every v2 client reads the header. But anything that reads
// the body -- a human with curl, a log line, an agent written against the v1
// pattern where requirements lived in the JSON body -- sees an empty object,
// concludes the route is not payable, and leaves without sending anything we
// could ever log. An independent conformance agent (cairnwake.com) pointed this
// out on 1 September 2026. It was right, and it had been true since launch.
//
// The body is the DECODED HEADER, not a second copy built from the route
// config. One source; nothing to drift. Honest limit: this helps whoever reads
// the body, but a strict v1 client still expects v1 field names
// (maxAmountRequired, network "base"), which v2 does not use. It is a
// legibility fix, not a compatibility shim, and it is described that way.
//
// Only the unpaid/failed 402 with an empty JSON body is touched. The HTML
// paywall (sent with res.send) and every non-402 response pass through.
export function mirror402Body() {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 402 && body && typeof body === "object" && Object.keys(body).length === 0) {
        const h = res.getHeader("payment-required");
        if (typeof h === "string" && h.length) {
          try { return json(JSON.parse(Buffer.from(h, "base64").toString("utf8"))); }
          catch { /* not decodable: send the empty body as the library intended */ }
        }
      }
      return json(body);
    };
    next();
  };
}
