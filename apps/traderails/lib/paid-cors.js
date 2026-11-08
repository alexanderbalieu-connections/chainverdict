import { paidRouteMatchers } from './paid-route-matchers.js';

// Browser x402 clients need to read the quote and preflight a signed retry.
// Scope this to public paid APIs, with no credentialed CORS.
export function paidCors(routeKeys) {
  const routes = paidRouteMatchers(routeKeys);
  return (req, res, next) => {
    const preflight = req.method === 'OPTIONS';
    const method = preflight ? req.get('access-control-request-method') : req.method;
    if (!routes.some(route => route.method === method && route.pattern.test(req.path))) return next();

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, X-Signature, X-Signed-At');
    if (!preflight) return next();

    res.set('Access-Control-Allow-Methods', method);
    res.set('Access-Control-Allow-Headers', 'Content-Type, PAYMENT-SIGNATURE, X-PAYMENT');
    res.set('Access-Control-Max-Age', '600');
    res.vary('Access-Control-Request-Method');
    return res.sendStatus(204);
  };
}
