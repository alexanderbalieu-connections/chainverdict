import https from "node:https";
import { proxyHeaders } from "./api-gateway.js";

const pulse = "https://pulse.chainverdict.xyz";
const apex = "https://chainverdict.xyz";
const pages = new Set([
  "index.html", "evidence.html", "inspector.html", "purchase-evidence.html",
  "status.html", "collection-method.html", "comparison.html", "evidence-example.html",
  "verify.html", "dashboard.html",
]);
const assets = /^(?:(?:inspector|integration)\/(?:[\w.-]+\/)*[\w.-]+|brand\.css|status\.css|status\.js|payments-dashboard\.js|payment-chart\.js|favicon\.ico)$/;
const publicReads = new Set([
  "healthz", "v1/status", "v1/archive/anchors", "v1/archive/integrity",
  "v1/selfcheck", "v1/payments/transfers",
]);
const docs = /^(?:v1\/|\.well-known\/|openapi\.json$|llms\.txt$)/;

function pageLink(url) {
  return url === "/" ? "/pulse/" : "/pulse" + url;
}

export function canonicalPulsePage(html) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (match, attribute, value) => {
    if (attribute === "href" && value === "https://trade.chainverdict.xyz/") return 'href="/traderails"';
    const local = value.startsWith(pulse + "/") ? value.slice(pulse.length) : value;
    if (!local.startsWith("/") || local.startsWith("//")) return match;
    const path = local.split(/[?#]/, 1)[0].slice(1);
    const target = !path || pages.has(path) || assets.test(path)
      ? pageLink(local)
      : docs.test(path) || path === "healthz" ? pulse + local : local;
    const canonical = value.startsWith(pulse + "/") && target.startsWith("/pulse/") ? apex + target : target;
    return `${attribute}="${canonical}"`;
  }).replaceAll("'/v1/archive/anchors?", "'/pulse/v1/archive/anchors?")
    .replaceAll("'/evidence.html#integrate", "'/pulse/evidence.html#integrate");
}

export function pulseWebsite(req, res, next) {
  if (req.path !== "/pulse" && !req.path.startsWith("/pulse/")) return next();
  if (req.path === "/pulse") return res.redirect(308, "/pulse/" + req.url.slice(req.path.length));
  const path = req.path.slice("/pulse/".length) || "index.html";
  const read = req.method === "GET" || req.method === "HEAD";
  const owner = (path === "v1/owner/payments" && req.method === "GET")
    || (path === "v1/owner/session" && ["POST", "DELETE"].includes(req.method));
  const page = pages.has(path);
  const asset = assets.test(path) && !path.split("/").some(part => part.startsWith("."));
  if (!owner && !(read && (page || asset || publicReads.has(path)))) return res.sendStatus(404);

  const query = req.url.slice(req.path.length);
  const headers = { "accept-encoding": "identity" };
  if (owner) {
    for (const name of ["authorization", "cookie", "origin"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
  }
  const upstream = https.request(pulse + "/" + (page ? "_website/" : "") + path + query, {
    method: req.method, headers, timeout: 25000,
  }, response => {
    const responseHeaders = proxyHeaders(response.headers);
    if (owner) responseHeaders["cache-control"] = "no-store";
    if (!page || req.method === "HEAD" || response.statusCode !== 200) {
      res.writeHead(response.statusCode, responseHeaders);
      response.pipe(res);
    } else {
      delete responseHeaders["content-length"];
      delete responseHeaders.etag;
      delete responseHeaders["last-modified"];
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        res.writeHead(200, responseHeaders);
        res.end(canonicalPulsePage(chunks.join("")));
      });
    }
    response.on("error", () => res.destroy());
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (res.headersSent) res.destroy();
    else res.sendStatus(502);
  });
  res.on("close", () => upstream.destroy());
  upstream.end();
}
