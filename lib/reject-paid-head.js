import { paidRouteMatchers } from './paid-route-matchers.js';
// HEAD has no response body: refuse it before payment or paid handler execution.
// Derive paths from the price table, including wildcard parameters. Match Express's
// default case-insensitive, optional trailing slash behaviour.
export function rejectPaidHead(routeKeys) {
  const paths = paidRouteMatchers(routeKeys).filter(r => r.method === 'GET').map(r => r.pattern);
  return (req, res, next) => {
    if (req.method === 'HEAD' && paths.some(p => p.test(req.path))) {
      return res.status(405).set('Allow', 'GET').set('Cache-Control', 'no-store').end();
    }
    next();
  };
}
